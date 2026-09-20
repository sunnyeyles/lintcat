/** Serves a fixture repository through the read interfaces a planted repository can honour. */
import process from "node:process";

import type {
  ChangedFile,
  CheckRunSummary,
  CodeSearchMatch,
  CodeSearchResult,
  ExistingReviewComment,
  FileContentsRequest,
  PullRequestDetails,
  PullRequestReadClient,
  PullRequestRef,
  RepositoryArchive,
  RepositoryArchiveRequest,
  RepositoryHistoryClient,
  ReviewThread,
} from "@pr-review/github";

import type { LoadedFixture } from "#src/fixture";

/** At most this many search matches come back from one query. */
const MAX_SEARCH_MATCHES = 25;

/** Set to `off` for the control arm: the archive is unavailable, so no index is built. */
export const INDEX_ENV = "EVAL_INDEX";

/** The control arm runs the identical suite with the index absent. */
export function indexEnabled(env: Record<string, string | undefined>): boolean {
  return (env[INDEX_ENV] ?? "").trim().toLowerCase() !== "off";
}

/** Characters of context either side of a match, as GitHub's fragments have. */
const FRAGMENT_PADDING = 120;

/** Stands in for GitHub's text-match fragments: a window around each term. */
function fragmentsAround(
  contents: string,
  lowered: string,
  terms: string[],
): string[] {
  const windows = terms.flatMap((term) => {
    const at = lowered.indexOf(term);
    return at < 0
      ? []
      : [
          contents.slice(
            Math.max(0, at - FRAGMENT_PADDING),
            at + term.length + FRAGMENT_PADDING,
          ),
        ];
  });
  return [...new Set(windows)];
}

/** GitHub's grammar: a quoted phrase is one term, everything else splits on space. */
function searchTerms(query: string): string[] {
  return (query.toLowerCase().match(/"[^"]*"|\S+/g) ?? [])
    .map((term) => term.replaceAll('"', ""))
    .filter((term) => term.length > 0);
}

/** One recorded read against the fixture repository. */
export interface FixtureCall {
  method: string;
  detail: string;
}

/** No publishing, and no commit objects to read files, messages or comparisons out of. */
export type FixtureGithubClient = PullRequestReadClient &
  Omit<
    RepositoryHistoryClient,
    "listCommitFiles" | "compareCommits" | "getCommitMessage"
  >;

interface FixtureClient {
  client: FixtureGithubClient;
  /** Every read the agents performed, in order. */
  calls: FixtureCall[];
}

/** Thrown for a read the fixture repository cannot answer. */
class FixtureNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureNotFoundError";
  }
}

export function createFixtureClient(fixture: LoadedFixture): FixtureClient {
  const calls: FixtureCall[] = [];
  const record = (method: string, detail: string): void => {
    calls.push({ method, detail });
  };

  const checkRef = (ref: PullRequestRef): void => {
    const { owner, repo, pullRequest } = fixture.context;
    if (
      ref.owner !== owner ||
      ref.repo !== repo ||
      ref.pullRequestNumber !== pullRequest.number
    ) {
      throw new FixtureNotFoundError(
        `fixture ${fixture.name} serves ${owner}/${repo}#${pullRequest.number}, not ` +
          `${ref.owner}/${ref.repo}#${ref.pullRequestNumber}`,
      );
    }
  };

  const client: FixtureGithubClient = {
    async getPullRequest(ref): Promise<PullRequestDetails> {
      checkRef(ref);
      record("getPullRequest", `#${ref.pullRequestNumber}`);
      return fixture.pullRequest;
    },

    async listChangedFiles(ref): Promise<ChangedFile[]> {
      checkRef(ref);
      record("listChangedFiles", `#${ref.pullRequestNumber}`);
      return fixture.changedFiles.map((file) => ({ ...file }));
    },

    async getDiff(ref): Promise<string> {
      checkRef(ref);
      record("getDiff", `#${ref.pullRequestNumber}`);
      return fixture.diff;
    },

    async getFileContents(request: FileContentsRequest): Promise<string> {
      const { owner, repo } = fixture.context;
      if (request.owner !== owner || request.repo !== repo) {
        throw new FixtureNotFoundError(
          `fixture ${fixture.name} serves ${owner}/${repo}, not ${request.owner}/${request.repo}`,
        );
      }
      // Reads are pinned to a SHA: head is the proposed state, base the
      // state before the pull request, where an added file is absent.
      const atHead = request.ref === fixture.pullRequest.headSha;
      const tree = atHead ? fixture.headFiles : fixture.baseFiles;
      record("getFileContents", `${request.path} @ ${atHead ? "head" : "base"}`);
      const contents = tree.get(request.path);
      if (contents === undefined) {
        throw new FixtureNotFoundError(
          `Not Found: ${request.path} does not exist at ${request.ref}`,
        );
      }
      return contents;
    },

    async searchCode(request): Promise<CodeSearchResult> {
      const { owner, repo } = fixture.context;
      if (request.owner !== owner || request.repo !== repo) {
        throw new FixtureNotFoundError(
          `fixture ${fixture.name} serves ${owner}/${repo}, not ${request.owner}/${request.repo}`,
        );
      }
      record("searchCode", request.query);
      const terms = searchTerms(request.query);
      const matches: CodeSearchMatch[] = [];
      for (const [path, contents] of fixture.headFiles) {
        const lowered = contents.toLowerCase();
        const haystack = `${path.toLowerCase()}\n${lowered}`;
        if (terms.every((term) => haystack.includes(term))) {
          matches.push({
            path,
            name: path.slice(path.lastIndexOf("/") + 1),
            snippets: fragmentsAround(contents, lowered, terms),
          });
        }
      }
      return {
        matches: matches.slice(0, MAX_SEARCH_MATCHES),
        totalCount: matches.length,
        incompleteResults: false,
      };
    },

    async getRepositoryArchive(
      request: RepositoryArchiveRequest,
    ): Promise<RepositoryArchive> {
      const { owner, repo } = fixture.context;
      if (request.owner !== owner || request.repo !== repo) {
        throw new FixtureNotFoundError(
          `fixture ${fixture.name} serves ${owner}/${repo}, not ${request.owner}/${request.repo}`,
        );
      }
      record("getRepositoryArchive", request.ref);
      if (!indexEnabled(process.env)) {
        throw new FixtureNotFoundError(
          `${INDEX_ENV}=off: the archive of ${owner}/${repo} is unavailable for this run`,
        );
      }
      // The index is always built at the base commit, so that is what it serves.
      return {
        sha: request.ref,
        files: new Map(fixture.baseFiles),
        truncated: false,
      };
    },

    // A fixture has no commits; inventing history would make the eval lie.
    async listCommitShas(request): Promise<string[]> {
      record("listCommitShas", request.path);
      return [];
    },

    async listReviewComments(ref): Promise<ExistingReviewComment[]> {
      checkRef(ref);
      // A fixture pull request carries no prior review, so every
      // finding is new every time.
      return [];
    },

    async listReviewThreads(ref): Promise<ReviewThread[]> {
      checkRef(ref);
      return [];
    },

    async listPullRequestCommitShas(ref): Promise<string[]> {
      checkRef(ref);
      return [fixture.pullRequest.headSha];
    },

    // A fixture has one commit, so no earlier review.
    async listCheckRuns(): Promise<CheckRunSummary[]> {
      return [];
    },

    // The branch never moves, so patch verification sees the head it proved against.
    async getBranchTip(): Promise<string> {
      return fixture.pullRequest.headSha;
    },
  };

  return { client, calls };
}
