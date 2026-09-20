import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  collectRepositoryFiles,
  DEFAULT_ARCHIVE_LIMITS,
  matchesTerms,
  parseSearchQuery,
  readRepositoryTarball,
  searchMatchedPaths,
  type ChangedFile,
  type PullRequestDetails,
  type PullRequestReadClient,
  type RepositoryArchive,
  type RepositoryFileEntry,
  type RepositoryHistoryClient,
} from "@pr-review/github";
import type { ReviewTarget } from "@pr-review/reviewer";

import { assertRef, git, gitBuffer, GitError } from "#src/git";
import { addedFileDiff, parseUnifiedDiff } from "#src/unified-diff";

/** The head "commit" of a local review: files as they are on disk now. */
export const WORKING_TREE = "WORKING_TREE";

/** No publishing, and no second commit to compare the working tree against. */
type LocalGitClient = PullRequestReadClient &
  Omit<RepositoryHistoryClient, "compareCommits">;

/** One local checkout, reviewed as if its uncommitted state were a pull request. */
export interface LocalRepository {
  root: string;
  owner: string;
  repo: string;
  baseRef: string;
  baseSha: string;
  branch: string;
  target: ReviewTarget;
  client: LocalGitClient;
}

async function tryGit(root: string, args: readonly string[]): Promise<string | undefined> {
  try {
    return (await git(root, args)).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function defaultBaseRef(root: string): Promise<string> {
  const remoteHead = await tryGit(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead !== undefined) {
    return remoteHead;
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if ((await tryGit(root, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`])) !== undefined) {
      return candidate;
    }
  }
  throw new GitError("no default branch found; pass `base` explicitly");
}

function ownerAndRepo(remoteUrl: string | undefined, root: string): { owner: string; repo: string } {
  const match = remoteUrl && /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  return match ? { owner: match[1]!, repo: match[2]! } : { owner: "local", repo: path.basename(root) };
}

/** The checkout holding `repoPath`, with symlinks resolved. */
export async function repositoryRoot(repoPath: string): Promise<string> {
  return realpathSync((await git(repoPath, ["rev-parse", "--show-toplevel"])).trim());
}

/** Resolves `repoPath` to its checkout and the base the working tree is compared against. */
export async function openLocalRepository(
  repoPath: string,
  base?: string | undefined,
): Promise<LocalRepository> {
  const root = await repositoryRoot(repoPath);
  const baseRef = assertRef(base ?? (await defaultBaseRef(root)));
  const baseSha = (await git(root, ["merge-base", baseRef, "HEAD"])).trim();
  const branch = (await tryGit(root, ["branch", "--show-current"])) ?? "HEAD";
  const { owner, repo } = ownerAndRepo(await tryGit(root, ["remote", "get-url", "origin"]), root);
  const target: ReviewTarget = { owner, repo, pullRequestNumber: 0, headSha: WORKING_TREE };
  const repository = { root, owner, repo, baseRef, baseSha, branch, target };
  return { ...repository, client: createLocalGitClient(repository) };
}

/** A path inside the checkout, with symlinks resolved; anything else is a 404. */
export function resolveInside(root: string, file: string): string {
  const resolved = path.resolve(root, file);
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    throw new GitError(`${file} does not exist in the working tree`, 404);
  }
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new GitError(`${file} is outside the repository`, 404);
  }
  return real;
}

/** One matching line, as `git grep -n` reports it. */
export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

/** The checkout-relative form of a path, or a 404 if it escapes the checkout. */
function relativeInside(root: string, file: string): string {
  const real = resolveInside(root, file);
  return real === root ? "." : path.relative(root, real);
}

/**
 * The shared search semantics, line-oriented: `parseSearchQuery` reads the
 * query and `matchesTerms` judges each line rather than each file.
 */
export async function searchWorkingTree(
  root: string,
  query: string,
  scope?: string | undefined,
): Promise<SearchHit[]> {
  const terms = parseSearchQuery(query);
  if (terms.length === 0) {
    return [];
  }
  const pathspec = scope === undefined ? [] : ["--", relativeInside(root, scope)];
  // git narrows to files holding every term; matchesTerms then keeps the lines that do.
  const output = await git(
    root,
    [
      "grep",
      "-I",
      "-n",
      "-i",
      "-F",
      "--untracked",
      "--all-match",
      ...terms.flatMap((term) => ["-e", term]),
      ...pathspec,
    ],
    { okExitCodes: [1] },
  );
  const hits: SearchHit[] = [];
  for (const line of output.split("\n")) {
    const match = /^(.+?):(\d+):(.*)$/.exec(line);
    if (match && matchesTerms(match[3]!, terms)) {
      hits.push({ path: match[1]!, line: Number(match[2]), text: match[3]!.trim() });
    }
  }
  return hits;
}

function* workingTreeFiles(root: string, paths: readonly string[]): Generator<RepositoryFileEntry> {
  for (const file of paths) {
    const absolute = path.join(root, file);
    let size: number;
    try {
      const stat = statSync(absolute);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    yield { path: file, size, read: () => readFileSync(absolute) };
  }
}

/** A symlink's content is its target, as git records it; a read error fails the review. */
function untrackedContent(root: string, file: string): Uint8Array {
  const absolute = path.join(root, file);
  return lstatSync(absolute).isSymbolicLink()
    ? Buffer.from(readlinkSync(absolute))
    : readFileSync(absolute);
}

function createLocalGitClient(
  repository: Omit<LocalRepository, "client">,
): LocalGitClient {
  const { root, baseSha, baseRef, branch } = repository;

  let snapshot: Promise<{ diff: string; files: ChangedFile[] }> | undefined;
  // Taken once, so every reader of one review sees the same working tree.
  const changes = () => {
    snapshot ??= (async () => {
      // Fixed prefixes: diff.mnemonicPrefix or diff.noprefix would otherwise rename every path.
      const tracked = await git(root, [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        baseSha,
      ]);
      // A trailing slash is a nested repository, which has no content of its own to diff.
      const untracked = (await git(root, ["ls-files", "-z", "--others", "--exclude-standard"]))
        .split("\0")
        .filter((file) => file !== "" && !file.endsWith("/"));
      const added = untracked.map((file) => addedFileDiff(file, untrackedContent(root, file)));
      const diff = [tracked, ...added].filter((part) => part !== "").join("");
      return { diff, files: parseUnifiedDiff(diff) };
    })();
    return snapshot;
  };

  const readAt = async (ref: string, file: string): Promise<string> => {
    if (ref === WORKING_TREE) {
      return readFileSync(resolveInside(root, file), "utf8");
    }
    try {
      return await git(root, ["show", `${assertRef(ref)}:${file}`]);
    } catch (error) {
      throw new GitError(`${file} does not exist at ${ref}: ${(error as Error).message}`, 404);
    }
  };

  return {
    async getPullRequest(): Promise<PullRequestDetails> {
      const subjects = await git(root, ["log", "--format=- %s", `${baseSha}..HEAD`]);
      return {
        number: 0,
        title: `Local changes on ${branch}`,
        body: subjects.trim() === "" ? null : `Commits since ${baseRef}:\n${subjects.trim()}`,
        author: (await tryGit(root, ["config", "user.name"])) ?? null,
        baseRef,
        baseSha,
        headRef: branch,
        headSha: WORKING_TREE,
      };
    },
    async listChangedFiles() {
      return (await changes()).files;
    },
    async getDiff() {
      return (await changes()).diff;
    },
    getFileContents: ({ path: file, ref }) => readAt(ref, file),
    async searchCode({ query }) {
      const terms = parseSearchQuery(query);
      if (terms.length === 0) {
        return { matches: [], totalCount: 0, incompleteResults: false };
      }
      // -l -i -F --all-match is git's spelling of matchesTerms: contents only, every term.
      const output = await git(
        root,
        ["grep", "-I", "-l", "-i", "-F", "--untracked", "--all-match", ...terms.flatMap((term) => ["-e", term])],
        { okExitCodes: [1] },
      );
      const paths = output.split("\n").filter((file) => file !== "");
      return searchMatchedPaths(query, paths, (file) =>
        Buffer.from(untrackedContent(root, file)).toString("utf8"),
      );
    },
    async getRepositoryArchive({ ref, limits }): Promise<RepositoryArchive> {
      if (ref === WORKING_TREE) {
        const listed = (await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
          .split("\0")
          .filter((file) => file !== "");
        return { sha: WORKING_TREE, ...collectRepositoryFiles(workingTreeFiles(root, listed), limits) };
      }
      const sha = (await git(root, ["rev-parse", `${assertRef(ref)}^{commit}`])).trim();
      const tarball = await gitBuffer(root, ["archive", "--format=tar", "--prefix=repository/", sha], {
        maxBuffer: limits?.maxInflatedBytes ?? DEFAULT_ARCHIVE_LIMITS.maxInflatedBytes,
      });
      return { sha, ...readRepositoryTarball(new Uint8Array(tarball), limits) };
    },
    async listCommitShas({ path: file, limit }) {
      const output = await git(root, ["log", "--format=%H", "-n", String(limit), "HEAD", "--", file]);
      return output.split("\n").filter((sha) => sha !== "");
    },
    async listCommitFiles({ sha }) {
      const output = await git(root, ["show", "--name-only", "--format=", "--no-renames", assertRef(sha)]);
      return output.split("\n").filter((file) => file !== "");
    },
    async listPullRequestCommitShas() {
      const output = await git(root, ["rev-list", "--reverse", `${baseSha}..HEAD`]);
      return output.split("\n").filter((sha) => sha !== "");
    },
    listCheckRuns: async () => [],
    listReviewComments: async () => [],
    listReviewThreads: async () => [],
    async getBranchTip({ branch: name }) {
      return (await git(root, ["rev-parse", `refs/heads/${assertRef(name)}`])).trim();
    },
    async getCommitMessage({ sha }) {
      return git(root, ["log", "-1", "--format=%B", assertRef(sha)]);
    },
  };
}
