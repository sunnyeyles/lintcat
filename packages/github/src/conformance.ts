/** One suite every client adapter runs; ADAPTER_PROFILES records each divergence. */
import { describe, expect, it } from "vitest";

import type {
  GithubInstallationClient,
  PullRequestReadClient,
  PullRequestRef,
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "#src/client";

export type ClientMethod = keyof GithubInstallationClient;

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
};

const PUBLISH_METHOD_SET: Record<keyof ReviewPublishClient, true> = {
  createCheckRun: true,
  createReview: true,
  createCommitOnBranch: true,
  writeFileOnBranch: true,
};

/** The three narrow interfaces, as method names; together they are the wide client. */
export const METHOD_GROUPS = {
  "pull-request-read": Object.keys(READ_METHOD_SET) as ClientMethod[],
  "repository-history": Object.keys(HISTORY_METHOD_SET) as ClientMethod[],
  "review-publish": Object.keys(PUBLISH_METHOD_SET) as ClientMethod[],
};

export type ClientGroup = keyof typeof METHOD_GROUPS;

export const CLIENT_METHODS = Object.values(METHOD_GROUPS).flat();

/** Matches packages/ai keeps from any adapter; capping below it silently narrows what the agent sees. */
export const AGENT_TOOL_SEARCH_MATCHES = 20;

/** Where adapters differ most: none of these three numbers agree. */
export interface SearchProfile {
  /** Matches one query returns at most; null when the adapter never truncates. */
  maxMatches: number | null;
  /** Snippets per match at most; null when the adapter never truncates them. */
  maxSnippetsPerMatch: number | null;
  /** How a file is decided to match, in words. */
  matching: string;
  /** False when every query gets the same fixed answer. */
  honoursQuery: boolean;
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

/** Every adapter side by side. A number that moves here has to move in the adapter too. */
export const ADAPTER_PROFILES = {
  octokit: {
    backing: "the GitHub REST and GraphQL APIs",
    search: {
      maxMatches: 20,
      maxSnippetsPerMatch: null,
      matching: "GitHub code search over the default branch index",
      honoursQuery: true,
    },
    absent: [],
    unsupported: {},
    missingFileError: "HttpError",
  },
  "local-checkout": {
    backing: "a git checkout on disk, head being the working tree",
    search: {
      maxMatches: 30,
      maxSnippetsPerMatch: 3,
      matching: "git grep -F -i, every term required, contents only",
      honoursQuery: true,
    },
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
    search: {
      maxMatches: 25,
      maxSnippetsPerMatch: null,
      matching: "case-insensitive substring AND over path and contents, one window per term",
      honoursQuery: true,
    },
    absent: [
      "listCommitFiles",
      "compareCommits",
      "getCommitMessage",
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
    search: {
      maxMatches: null,
      maxSnippetsPerMatch: null,
      matching: "nothing is matched; one canned result answers every query",
      honoursQuery: false,
    },
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
  /** A query matching more files than the adapter is willing to return. */
  flood: { query: string; totalMatches: number };
  /** A query whose single matching file comes back with this many snippets. */
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
        expect(Array.isArray(match.snippets)).toBe(true);
        for (const snippet of match.snippets) expect(typeof snippet).toBe("string");
      }
      if (profile.search.honoursQuery) {
        expect(result.matches.map((match) => match.path)).toEqual([file.path]);
      }
    });

    it(
      profile.search.honoursQuery
        ? "returns nothing for a query the repository has no match for"
        : "answers a query it cannot match with the same canned result",
      async () => {
        const { client, ref, search } = await open();
        const scope = { owner: ref.owner, repo: ref.repo };

        const absent = await client.searchCode({ ...scope, query: search.absent });
        if (profile.search.honoursQuery) {
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
      profile.search.maxMatches === null
        ? "never truncates its matches"
        : `caps its matches at ${profile.search.maxMatches} and still reports the true total`,
      async () => {
        const { client, ref, search } = await open();

        const result = await client.searchCode({
          owner: ref.owner,
          repo: ref.repo,
          query: search.flood.query,
        });
        expect(result.totalCount).toBe(search.flood.totalMatches);
        if (profile.search.maxMatches === null) {
          expect(result.matches).toHaveLength(result.totalCount);
        } else {
          expect(result.matches).toHaveLength(profile.search.maxMatches);
          expect(result.totalCount).toBeGreaterThan(result.matches.length);
        }
      },
    );

    it(
      profile.search.maxSnippetsPerMatch === null
        ? "returns every snippet it found for one match"
        : `caps one match at ${profile.search.maxSnippetsPerMatch} snippets`,
      async () => {
        const { client, ref, search } = await open();

        const result = await client.searchCode({
          owner: ref.owner,
          repo: ref.repo,
          query: search.repeated.query,
        });
        const match = result.matches[0];
        expect(match).toBeDefined();
        expect(match?.snippets).toHaveLength(search.repeated.snippets);
        if (profile.search.maxSnippetsPerMatch !== null) {
          expect(search.repeated.snippets).toBeLessThanOrEqual(
            profile.search.maxSnippetsPerMatch,
          );
        }
      },
    );

    it("returns at least as many matches as the agent tool keeps", () => {
      const cap = profile.search.maxMatches;
      expect(cap === null || cap >= AGENT_TOOL_SEARCH_MATCHES).toBe(true);
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
