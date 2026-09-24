/** One suite every client adapter runs; ADAPTER_PROFILES records each divergence. */
import { describe, expect, it } from "vitest";

import type {
  BlameRange,
  PullRequestReadClient,
  PullRequestRef,
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "#src/client";
import { SEARCH_LIMITS } from "#src/search";

export type ClientMethod =
  | keyof PullRequestReadClient
  | keyof RepositoryHistoryClient
  | keyof ReviewPublishClient;

// Records, not arrays: the compiler rejects a list once its interface grows.
const READ_METHOD_SET: Record<keyof PullRequestReadClient, true> = {
  getPullRequest: true,
  listChangedFiles: true,
  getDiff: true,
  getFileContents: true,
  searchCode: true,
  getRepositoryArchive: true,
  listCheckRuns: true,
  listReviewComments: true,
  listReviewThreads: true,
};

const HISTORY_METHOD_SET: Record<keyof RepositoryHistoryClient, true> = {
  listCommitShas: true,
  listCommitFiles: true,
  listPullRequestCommitShas: true,
  compareCommits: true,
  getBranchTip: true,
  getCommitMessage: true,
  blame: true,
};

const PUBLISH_METHOD_SET: Record<keyof ReviewPublishClient, true> = {
  createCheckRun: true,
  createReview: true,
  createCommitOnBranch: true,
  writeFileOnBranch: true,
};

/** The three narrow interfaces, as method names; together they are every client method. */
export const METHOD_GROUPS = {
  "pull-request-read": Object.keys(READ_METHOD_SET) as ClientMethod[],
  "repository-history": Object.keys(HISTORY_METHOD_SET) as ClientMethod[],
  "review-publish": Object.keys(PUBLISH_METHOD_SET) as ClientMethod[],
};

export type ClientGroup = keyof typeof METHOD_GROUPS;

export const CLIENT_METHODS = Object.values(METHOD_GROUPS).flat();

/** Matches packages/ai keeps from any adapter; capping below it silently narrows what the agent sees. */
export const AGENT_TOOL_SEARCH_MATCHES = 20;

/** All that is left to an adapter: SEARCH_LIMITS owns the grammar and the caps. */
export interface SearchProfile {
  /** What decides a file matches; only "shared" runs #src/search's own rule. */
  matching: "shared" | "github-code-index" | "canned";
  /** What fills a match before the shared snippet cap trims it. */
  snippets: "shared-windows" | "github-fragments" | "canned";
}

/** A canned adapter answers every query the same way, so no query test can bind it. */
function honoursQuery(profile: AdapterProfile): boolean {
  return profile.search.matching !== "canned";
}

/** Every adapter honours all of `PullRequestReadClient`; the rest it declares only if it honours it. */
export type ConformanceClient = PullRequestReadClient &
  Partial<RepositoryHistoryClient & ReviewPublishClient>;

export interface AdapterProfile {
  /** What this adapter reads the repository out of. */
  backing: string;
  search: SearchProfile;
  /** Methods the adapter's type does not declare: calling one is a compile error, not a throw. */
  absent: readonly ClientMethod[];
  /** Methods that always reject, by the `name` of the error they reject with. */
  unsupported: Partial<Record<ClientMethod, string>>;
  /** The error `name` a read of an absent path rejects with; null when it never rejects. */
  missingFileError: string | null;
}

/** Every adapter side by side; anything absent here is shared and asserted identically. */
export const ADAPTER_PROFILES = {
  octokit: {
    backing: "the GitHub REST and GraphQL APIs",
    search: { matching: "github-code-index", snippets: "github-fragments" },
    absent: [],
    unsupported: {},
    missingFileError: "HttpError",
  },
  "local-checkout": {
    backing: "a git checkout on disk, head being the working tree",
    search: { matching: "shared", snippets: "shared-windows" },
    absent: [
      "compareCommits",
      "createCheckRun",
      "createReview",
      "createCommitOnBranch",
      "writeFileOnBranch",
    ],
    unsupported: {},
    missingFileError: "GitError",
  },
  "eval-fixture": {
    backing: "a planted fixture repository held in memory",
    search: { matching: "shared", snippets: "shared-windows" },
    absent: [
      "listCommitFiles",
      "compareCommits",
      "getCommitMessage",
      "blame",
      "createCheckRun",
      "createReview",
      "createCommitOnBranch",
      "writeFileOnBranch",
    ],
    unsupported: {},
    missingFileError: "FixtureNotFoundError",
  },
  "agent-test-fake": {
    backing: "hard-coded literals in packages/ai/src/agent-test-support.ts",
    search: { matching: "canned", snippets: "canned" },
    absent: [],
    unsupported: { writeFileOnBranch: "Error" },
    missingFileError: null,
  },
} as const satisfies Record<string, AdapterProfile>;

export type AdapterId = keyof typeof ADAPTER_PROFILES;

export interface ConformanceSearch {
  /** A query matching `file.path` and nothing else. */
  unique: string;
  /** A query the repository has no match for. */
  absent: string;
  /** A query appearing in some file's path but in no file's contents. */
  pathOnly: string;
  /** A query matching more files than SEARCH_LIMITS.maxMatches. */
  flood: { query: string; totalMatches: number };
  /** A query whose first matching file comes back with this many snippets. */
  repeated: { query: string; snippets: number };
}

/** One adapter's repository, described in the terms the suite addresses it by. */
export interface ConformanceCase {
  client: ConformanceClient;
  ref: PullRequestRef;
  /** Filenames listChangedFiles must report, in order. */
  changedFilenames: readonly string[];
  /** A file the repository holds, and its exact contents at `ref`. */
  file: { path: string; ref: string; contents: string };
  /** A path the repository does not hold. */
  missingPath: string;
  search: ConformanceSearch;
}

const SAMPLE_SHA = "9f2c1a4b7e5d3c8a6f0b2d4e6a8c0e2f4a6b8d0c";

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Neither absent nor rejected, so the suite can hold the adapter to its answers. */
function honours(profile: AdapterProfile, method: ClientMethod): boolean {
  return !profile.absent.includes(method) && !(method in profile.unsupported);
}

/** A trailing newline ends the last line rather than starting another. */
function lineCount(contents: string): number {
  return contents === "" ? 0 : contents.replace(/\n$/, "").split("\n").length;
}

/** Every line once, in order, each with an author and a UTC ISO 8601 time. */
function expectWholeFileBlame(ranges: readonly BlameRange[], lines: number): void {
  let next = 1;
  for (const range of ranges) {
    expect(range.startLine).toBe(next);
    expect(range.endLine).toBeGreaterThanOrEqual(range.startLine);
    expect(range.author.trim()).not.toBe("");
    expect(range.login === null || range.login !== "").toBe(true);
    expect(new Date(range.committedAt).toISOString()).toBe(range.committedAt);
    next = range.endLine + 1;
  }
  expect(next - 1).toBe(lines);
}

function blamePath(
  client: ConformanceClient,
  ref: PullRequestRef,
  commit: string,
  path: string,
): Promise<BlameRange[]> {
  return (
    client.blame?.({ owner: ref.owner, repo: ref.repo, ref: commit, path }) ??
    Promise.reject(new Error("blame is absent from this adapter"))
  );
}

/** The one snippet shape: trimmed, non-empty, unique, and within both caps. */
function expectBoundedSnippets(snippets: readonly string[]): void {
  expect(snippets.length).toBeLessThanOrEqual(SEARCH_LIMITS.maxSnippetsPerMatch);
  expect(new Set(snippets).size).toBe(snippets.length);
  for (const snippet of snippets) {
    expect(typeof snippet).toBe("string");
    expect(snippet).toBe(snippet.trim());
    expect(snippet).not.toBe("");
    expect(snippet.length).toBeLessThanOrEqual(SEARCH_LIMITS.maxSnippetChars + 1);
  }
}

function callUnsupported(
  client: ConformanceClient,
  method: ClientMethod,
  ref: PullRequestRef,
): Promise<unknown> {
  const { owner, repo } = ref;
  const undeclared = (): Promise<never> =>
    Promise.reject(new Error(`${method} is absent from this adapter`));
  switch (method) {
    case "listCommitFiles":
      return client.listCommitFiles?.({ owner, repo, sha: SAMPLE_SHA }) ?? undeclared();
    case "getCommitMessage":
      return client.getCommitMessage?.({ owner, repo, sha: SAMPLE_SHA }) ?? undeclared();
    case "blame":
      return (
        client.blame?.({ owner, repo, ref: SAMPLE_SHA, path: "conformance.txt" }) ??
        undeclared()
      );
    case "compareCommits":
      return (
        client.compareCommits?.({ owner, repo, base: SAMPLE_SHA, head: SAMPLE_SHA }) ??
        undeclared()
      );
    case "createCheckRun":
      return client.createCheckRun?.({
        owner,
        repo,
        headSha: SAMPLE_SHA,
        conclusion: "neutral",
        output: { title: "conformance", summary: "conformance" },
      }) ?? undeclared();
    case "createReview":
      return client.createReview?.({
        owner,
        repo,
        pullRequestNumber: ref.pullRequestNumber,
        commitSha: SAMPLE_SHA,
        body: "conformance",
        comments: [],
      }) ?? undeclared();
    case "createCommitOnBranch":
      return client.createCommitOnBranch?.({
        owner,
        repo,
        branch: "conformance",
        baseSha: SAMPLE_SHA,
        message: "conformance",
        files: [],
      }) ?? undeclared();
    case "writeFileOnBranch":
      return client.writeFileOnBranch?.({
        owner,
        repo,
        branch: "conformance",
        path: "conformance.txt",
        content: "conformance",
        message: "conformance",
      }) ?? undeclared();
    default:
      return Promise.reject(
        new Error(`the conformance suite has no sample call for ${method}`),
      );
  }
}

/** Runs the shared suite against one adapter; `open` yields a fresh case per test. */
export function runClientConformance(
  adapter: AdapterId,
  open: () => ConformanceCase | Promise<ConformanceCase>,
): void {
  const profile: AdapterProfile = ADAPTER_PROFILES[adapter];

  describe(`${adapter} conformance (${profile.backing})`, () => {
    it("implements every method it declares, and nothing it does not", async () => {
      const { client } = await open();
      const absent = new Set<ClientMethod>(profile.absent);

      for (const method of CLIENT_METHODS) {
        expect(typeof client[method], method).toBe(
          absent.has(method) ? "undefined" : "function",
        );
      }
      for (const method of Object.keys(profile.unsupported)) {
        expect(CLIENT_METHODS).toContain(method);
        expect(absent, method).not.toContain(method);
      }
    });

    it("identifies the pull request it was asked for", async () => {
      const { client, ref } = await open();

      const pullRequest = await client.getPullRequest(ref);
      expect(pullRequest.number).toBe(ref.pullRequestNumber);
      expect(pullRequest.baseRef).not.toBe("");
      expect(pullRequest.headSha).not.toBe("");
    });

    it("lists the changed files with counts and an optional patch", async () => {
      const { client, ref, changedFilenames } = await open();

      const files = await client.listChangedFiles(ref);
      expect(files.map((file) => file.filename)).toEqual([...changedFilenames]);
      for (const file of files) {
        expect(file.status).not.toBe("");
        expect(Number.isInteger(file.additions) && file.additions >= 0).toBe(true);
        expect(Number.isInteger(file.deletions) && file.deletions >= 0).toBe(true);
        expect(["string", "undefined"]).toContain(typeof file.patch);
      }
    });

    it("reads a file at a commit verbatim", async () => {
      const { client, ref, file } = await open();

      const contents = await client.getFileContents({
        owner: ref.owner,
        repo: ref.repo,
        path: file.path,
        ref: file.ref,
      });
      expect(contents).toBe(file.contents);
    });

    it(
      profile.missingFileError === null
        ? "serves any path, so an absent file is never reported"
        : `reports an absent file as ${profile.missingFileError}`,
      async () => {
        const { client, ref, file, missingPath } = await open();
        const read = client.getFileContents({
          owner: ref.owner,
          repo: ref.repo,
          path: missingPath,
          ref: file.ref,
        });

        if (profile.missingFileError === null) {
          await expect(read).resolves.toBe(file.contents);
        } else {
          await expect(read).rejects.toMatchObject({
            name: profile.missingFileError,
          });
        }
      },
    );

    it("returns search matches in the shape the agent tools consume", async () => {
      const { client, ref, file, search } = await open();

      const result = await client.searchCode({
        owner: ref.owner,
        repo: ref.repo,
        query: search.unique,
      });
      expect(result.incompleteResults).toBe(false);
      expect(result.totalCount).toBeGreaterThanOrEqual(result.matches.length);
      for (const match of result.matches) {
        expect(match.name).toBe(baseName(match.path));
        expectBoundedSnippets(match.snippets);
      }
      if (honoursQuery(profile)) {
        expect(result.matches.map((match) => match.path)).toEqual([file.path]);
      }
    });

    it(
      honoursQuery(profile)
        ? "returns nothing for a query the repository has no match for"
        : "answers a query it cannot match with the same canned result",
      async () => {
        const { client, ref, search } = await open();
        const scope = { owner: ref.owner, repo: ref.repo };

        const absent = await client.searchCode({ ...scope, query: search.absent });
        if (honoursQuery(profile)) {
          expect(absent.matches).toEqual([]);
          expect(absent.totalCount).toBe(0);
        } else {
          expect(absent).toEqual(
            await client.searchCode({ ...scope, query: search.unique }),
          );
        }
      },
    );

    it(
      honoursQuery(profile)
        ? "matches on contents alone, never on the path"
        : "answers a path-only query with the same canned result",
      async () => {
        const { client, ref, search } = await open();
        const scope = { owner: ref.owner, repo: ref.repo };

        const result = await client.searchCode({ ...scope, query: search.pathOnly });
        if (honoursQuery(profile)) {
          expect(result.matches).toEqual([]);
          expect(result.totalCount).toBe(0);
        } else {
          expect(result).toEqual(
            await client.searchCode({ ...scope, query: search.unique }),
          );
        }
      },
    );

    it(`caps its matches at ${SEARCH_LIMITS.maxMatches} and still reports the true total`, async () => {
      const { client, ref, search } = await open();

      const result = await client.searchCode({
        owner: ref.owner,
        repo: ref.repo,
        query: search.flood.query,
      });
      expect(result.totalCount).toBe(search.flood.totalMatches);
      expect(result.matches).toHaveLength(
        Math.min(result.totalCount, SEARCH_LIMITS.maxMatches),
      );
    });

    it(`caps one match at ${SEARCH_LIMITS.maxSnippetsPerMatch} snippets`, async () => {
      const { client, ref, search } = await open();

      const result = await client.searchCode({
        owner: ref.owner,
        repo: ref.repo,
        query: search.repeated.query,
      });
      const match = result.matches[0];
      expect(match).toBeDefined();
      expectBoundedSnippets(match?.snippets ?? []);
      expect(match?.snippets).toHaveLength(search.repeated.snippets);
    });

    if (honours(profile, "blame")) {
      it("blames every line of a file once, in order", async () => {
        const { client, ref, file } = await open();

        const ranges = await blamePath(client, ref, file.ref, file.path);
        expectWholeFileBlame(ranges, lineCount(file.contents));
      });

      it(
        profile.missingFileError === null
          ? "blames an absent path as it blames any other"
          : "blames an absent path as no lines at all",
        async () => {
          const { client, ref, file, missingPath } = await open();

          const ranges = await blamePath(client, ref, file.ref, missingPath);
          expect(ranges).toEqual(
            profile.missingFileError === null
              ? await blamePath(client, ref, file.ref, file.path)
              : [],
          );
        },
      );
    }

    it("keeps as many matches as the agent tool does", () => {
      expect(SEARCH_LIMITS.maxMatches).toBe(AGENT_TOOL_SEARCH_MATCHES);
    });

    const unsupported = Object.entries(profile.unsupported) as [
      ClientMethod,
      string,
    ][];
    const declared =
      unsupported.length === 0
        ? "declares no operation unsupported"
        : `rejects the ${unsupported.length} operation(s) it declares unsupported`;

    it(declared, async () => {
      const { client, ref } = await open();

      for (const [method, errorName] of unsupported) {
        await expect(
          callUnsupported(client, method, ref),
          method,
        ).rejects.toMatchObject({ name: errorName });
      }
    });
  });
}
