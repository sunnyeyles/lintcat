import {
  GENERAL_AGENT,
  ReviewCancelledError,
  type AgentRequest,
  type ReviewAgent,
  type ReviewContext,
  type ReviewEngine,
} from "@pr-review/ai";
import { ArchiveTooLargeError } from "@pr-review/github";
import type {
  BlameRange,
  ChangedFile,
  CheckRunSummary,
  CheckRunsRequest,
  CommitComparison,
  CreateCheckRunInput,
  CreateCommitInput,
  CreateReviewInput,
  ExistingReviewComment,
  PullRequestDetails,
  PullRequestReadClient,
  PullRequestRef,
  RepositoryArchiveRequest,
  RepositoryHistoryClient,
  ReviewPublishClient,
  ReviewThread,
  WriteFileRequest,
} from "@pr-review/github";
import {
  buildRepositoryIndex,
  snapshotRepositoryIndex,
  type RepositoryIndex,
} from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import {
  reviewMemorySchema,
  type MemoryShape,
  type ReviewFinding,
  type ReviewRecord,
} from "@pr-review/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { titleShape, type MemoryStore } from "#src/memory";
import type { PublishReview } from "#src/publish-review";
import { findingMarker } from "#src/render-review";
import {
  dashboardDelivery,
  githubDelivery,
  recordingDelivery,
  type ReviewDelivery,
} from "#src/review-delivery";
import {
  runReview,
  type ReviewMemory,
  type ReviewPolicy,
  type ReviewRunSpec,
} from "#src/review-run";
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

const pullRequest: PullRequestDetails = {
  number: 42,
  title: "Add rate limiting to the sessions endpoint",
  body: "Adds a token bucket to the sessions endpoint.",
  author: "octocat",
  baseRef: "main",
  baseSha: "0000000000000000000000000000000000000000",
  headRef: "feature/rate-limit",
  headSha: target.headSha,
};

const changedFiles: ChangedFile[] = [
  {
    filename: "src/sessions.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: "@@ -1 +1,2 @@\n const sessions = [];\n+const limit = 0;",
  },
];

const diff = "diff --git a/src/sessions.ts b/src/sessions.ts\n";

/** The tree the fake archive serves at the base commit. */
const baseFiles = new Map<string, string>([
  ["src/sessions.ts", "export const sessions = [];\n"],
  ["src/sessions.test.ts", "import './sessions';\n"],
  ["src/conventions/first.ts", "export const first = 1;\n"],
  ["src/conventions/second.ts", "export const second = 2;\n"],
]);

const finding: ReviewFinding = {
  file: "src/sessions.ts",
  line: 2,
  category: "naming",
  severity: "high",
  title: "Assignment instead of comparison in admin check",
  explanation:
    "The if condition assigns true to user.isAdmin instead of comparing, so every user passes the check.",
  evidence: [
    { file: "src/conventions/first.ts", line: 1 },
    { file: "src/conventions/second.ts", line: 1 },
  ],
  confidence: 0.9,
};

/** An Octokit-shaped error: the status is what the code reacts to. */
function permissionError(status: number): Error {
  return Object.assign(new Error("boom"), { status });
}

function makeClient() {
  return {
    getPullRequest: vi.fn(async (_ref: PullRequestRef) => pullRequest),
    listChangedFiles: vi.fn(async (_ref: PullRequestRef) => changedFiles),
    getDiff: vi.fn(async (_ref: PullRequestRef) => diff),
    getFileContents: vi.fn(async () => "export const sessions = [];\n"),
    searchCode: vi.fn(async () => ({
      matches: [],
      totalCount: 0,
      incompleteResults: false,
    })),
    getRepositoryArchive: vi.fn(async (request: RepositoryArchiveRequest) => ({
      sha: request.ref,
      files: new Map(baseFiles),
      truncated: false,
    })),
    listCommitShas: vi.fn(async () => []),
    listCommitFiles: vi.fn(async () => []),
    listReviewComments: vi.fn(async (): Promise<ExistingReviewComment[]> => []),
    listPullRequestCommitShas: vi.fn(async (): Promise<string[]> => [target.headSha]),
    listCheckRuns: vi.fn(
      async (_request: CheckRunsRequest): Promise<CheckRunSummary[]> => [],
    ),
    compareCommits: vi.fn(
      async (): Promise<CommitComparison> => ({ status: "ahead", files: [] }),
    ),
    getBranchTip: vi.fn(async () => target.headSha),
    getCommitMessage: vi.fn(async () => "Rate limit sessions"),
    blame: vi.fn(async (): Promise<BlameRange[]> => []),
    listReviewThreads: vi.fn(async (): Promise<ReviewThread[]> => []),
    createCheckRun: vi.fn(async (_input: CreateCheckRunInput) => ({ id: 987 })),
    createReview: vi.fn(async (_input: CreateReviewInput) => ({ id: 654 })),
    createCommitOnBranch: vi.fn(async (_input: CreateCommitInput) => ({
      sha: "fix1234",
    })),
    writeFileOnBranch: vi.fn(async (_request: WriteFileRequest) => {}),
  } satisfies PullRequestReadClient &
    RepositoryHistoryClient &
    ReviewPublishClient;
}

type FakeClient = ReturnType<typeof makeClient>;

/** Every write surface a run could reach through the client. */
function writesOf(client: FakeClient): number {
  return (
    client.createCheckRun.mock.calls.length +
    client.createReview.mock.calls.length +
    client.createCommitOnBranch.mock.calls.length +
    client.writeFileOnBranch.mock.calls.length
  );
}

const spent = {
  inputTokens: 100,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 20,
  outputTokens: 7,
};

/** An engine whose agent returns raw candidates, so validation runs for real. */
function scriptedEngine(candidates: readonly unknown[]) {
  const requests: AgentRequest[] = [];
  const agentRun = vi.fn(
    async (_context: ReviewContext): Promise<readonly unknown[]> => candidates,
  );
  const engine: ReviewEngine = {
    createAgent: (request): ReviewAgent => {
      requests.push(request);
      const name = request.agent.name;
      return {
        name,
        run: async (context) => {
          request.onUsage({ agent: name, durationMs: 1, steps: 1, salvaged: false, usage: spent });
          return agentRun(context);
        },
      };
    },
  };
  return { engine, requests, agentRun };
}

interface RunOptions extends ReviewPolicy {
  /** Replaces the GitHub adapter's check-run publisher, as the fork fallback does. */
  publishReview?: PublishReview;
  commitFixes?: boolean;
  memoryStore?: MemoryStore;
  now?: () => Date;
}

function makeRun(
  candidates: readonly unknown[] = [],
  { publishReview, commitFixes = false, memoryStore, now, ...policy }: RunOptions = {},
) {
  const client = makeClient();
  const { engine, requests, agentRun } = scriptedEngine(candidates);
  const { logger, entries } = createCapturingLogger();
  const github = githubDelivery({ client, logger, commitFixes });
  const spec: ReviewRunSpec = {
    client,
    target,
    engine,
    logger,
    policy,
    delivery:
      publishReview === undefined
        ? github
        : { ...github, publishCheckRun: publishReview },
    ...(memoryStore === undefined
      ? {}
      : { memory: { store: memoryStore, ...(now === undefined ? {} : { now }) } }),
  };
  return { spec, client, entries, requests, agentRun };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runReview", () => {
  it("loads the PR, its changed files, and its diff concurrently", async () => {
    const { spec, client } = makeRun();

    await runReview(spec);

    expect(client.getPullRequest).toHaveBeenCalledExactlyOnceWith(target);
    expect(client.listChangedFiles).toHaveBeenCalledExactlyOnceWith(target);
    expect(client.getDiff).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("runs the general agent against the loaded context with the same client", async () => {
    const { spec, client, requests, agentRun } = makeRun();

    await runReview(spec);

    expect(requests).toEqual([
      expect.objectContaining({
        agent: GENERAL_AGENT,
        github: client,
        index: expect.objectContaining({ sha: pullRequest.baseSha }),
      }),
    ]);
    expect(agentRun).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      pullRequest,
      changedFiles,
      diff,
      incremental: undefined,
      signal: undefined,
    });
  });

  it("totals the usage the engine reports onto the finished run", async () => {
    const { spec } = makeRun();

    const run = await runReview(spec);

    expect(run.usage).toEqual(spent);
  });

  it("publishes a check run through the GitHub adapter", async () => {
    const { spec, client } = makeRun([finding]);

    await runReview(spec);

    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
    expect(client.createCheckRun.mock.calls[0]?.[0]).toMatchObject({
      owner: target.owner,
      repo: target.repo,
      headSha: target.headSha,
      conclusion: "neutral",
    });
  });

  it("publishes through the check-run publisher the delivery carries", async () => {
    const publishReview = vi.fn<PublishReview>(async () => undefined);
    const { spec, client } = makeRun([finding], {
      publishReview,
    });

    await runReview(spec);

    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(publishReview).toHaveBeenCalledTimes(1);
    const [publishedTarget, rendered] = publishReview.mock.calls[0] ?? [];
    expect(publishedTarget).toEqual(target);
    expect(rendered?.output.summary).toContain(finding.title);
  });

  it("returns the outcome so callers can inspect the review", async () => {
    const { spec } = makeRun([finding]);

    const { outcome } = await runReview(spec);

    expect(outcome).toEqual({
      candidates: [finding],
      findings: [finding],
      patches: { proposed: 0, verified: 0 },
      suppressed: 0,
      baseSha: pullRequest.baseSha,
      changedFiles,
      graph: snapshotRepositoryIndex(
        buildRepositoryIndex({ sha: pullRequest.baseSha, files: baseFiles }),
      ),
      blastRadius: {
        impact: expect.any(Object),
        risk: expect.objectContaining({ band: "low" }),
      },
    });
  });

  it("carries the base commit and every changed file, index or no index", async () => {
    const { spec } = makeRun([], { index: false });

    const { outcome } = await runReview(spec);

    expect(outcome.baseSha).toBe(pullRequest.baseSha);
    expect(outcome.changedFiles).toEqual(changedFiles);
    expect(outcome.graph).toBeUndefined();
    expect(outcome.blastRadius).toBeUndefined();
  });

  it("serialises the index it built onto the outcome", async () => {
    const { spec } = makeRun();

    const { graph } = (await runReview(spec)).outcome;

    expect(graph?.sha).toBe(pullRequest.baseSha);
    expect(graph?.files.map((file) => file.path)).toEqual(
      [...baseFiles.keys()].sort(),
    );
    expect(graph?.edges).toEqual([
      { from: "src/sessions.test.ts", to: "src/sessions.ts", names: [] },
    ]);
  });

  it("emits the lifecycle events for one review", async () => {
    const { spec, entries } = makeRun([finding]);

    await runReview(spec);

    expect(entries.map((entry) => entry["event"])).toEqual([
      "review.loaded",
      "index.built",
      "risk.scored",
      "reviewers.suggested",
      "findings.validated",
      "patches.verified",
      "review.comments.published",
      "review.published",
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({ repository: "octo-org/example-service" });
    }
  });

  it("publishes only candidates that pass validation", async () => {
    const fabricated = { ...finding, file: "src/not-part-of-this-pr.ts", line: 7 };
    const offLine = { ...finding, line: 1, title: "On a context line" };
    const { spec, client } = makeRun([fabricated, offLine, { title: "no shape" }, finding]);

    const { outcome } = await runReview(spec);

    expect(outcome.candidates).toHaveLength(4);
    expect(outcome.findings).toEqual([finding]);
    expect(client.createReview.mock.calls[0]?.[0].comments).toHaveLength(1);
  });

  it("propagates an agent failure without publishing", async () => {
    const { spec, client, agentRun } = makeRun();
    agentRun.mockRejectedValueOnce(new Error("every agent failed"));

    await expect(runReview(spec)).rejects.toThrow(
      "every agent failed",
    );
    expect(client.createCheckRun).not.toHaveBeenCalled();
  });

  it("propagates a publish failure so the caller decides on retry", async () => {
    const publishReview = vi.fn<PublishReview>(async () => {
      throw new Error("check run rejected");
    });
    const { spec, entries } = makeRun([], { publishReview });

    await expect(runReview(spec)).rejects.toThrow(
      "check run rejected",
    );
    expect(entries.map((entry) => entry["event"])).not.toContain(
      "review.published",
    );
  });
});

describe("runReview inline comments", () => {
  it("publishes a review through the GitHub adapter", async () => {
    const { spec, client } = makeRun([finding]);

    await runReview(spec);

    expect(client.createReview).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      pullRequestNumber: target.pullRequestNumber,
      commitSha: target.headSha,
      body: expect.stringContaining("AI PR Review — 1 finding"),
      comments: [
        {
          path: finding.file,
          line: finding.line,
          body: expect.stringContaining(finding.title),
        },
      ],
    });
  });

  it("drops the check run annotations once the comments carry them", async () => {
    const { spec, client } = makeRun([finding]);

    await runReview(spec);

    expect(
      client.createCheckRun.mock.calls[0]?.[0].output.annotations,
    ).toBeUndefined();
  });

  it("keeps the annotations when the token cannot post comments", async () => {
    const { spec, client, entries } = makeRun([finding]);
    client.createReview.mockRejectedValueOnce(permissionError(403));

    await runReview(spec);

    expect(
      client.createCheckRun.mock.calls[0]?.[0].output.annotations,
    ).toHaveLength(1);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "review.comments.degraded", status: 403 }),
    );
  });

  it("fails the run on a comment error that is not a permission error", async () => {
    const { spec, client } = makeRun([finding]);
    client.createReview.mockRejectedValueOnce(permissionError(500));

    await expect(runReview(spec)).rejects.toThrow("boom");
    expect(client.createCheckRun).not.toHaveBeenCalled();
  });

  it("does not repeat a finding already commented on an earlier commit", async () => {
    const { spec, client } = makeRun([finding]);
    client.listReviewComments.mockResolvedValueOnce([
      { body: `stale text\n\n${findingMarker(finding)}` },
    ]);

    await runReview(spec);

    expect(client.createReview).not.toHaveBeenCalled();
  });

  it("does not re-annotate a finding whose earlier comment still stands", async () => {
    const { spec, client } = makeRun([finding]);
    client.listReviewComments.mockResolvedValueOnce([
      { body: `stale text\n\n${findingMarker(finding)}` },
    ]);

    await runReview(spec);

    expect(
      client.createCheckRun.mock.calls[0]?.[0].output.annotations,
    ).toBeUndefined();
  });

  it("names the dedupe as its own outcome, not a failure to post", async () => {
    const { spec, client, entries } = makeRun([finding]);
    client.listReviewComments.mockResolvedValueOnce([
      { body: `stale text\n\n${findingMarker(finding)}` },
    ]);

    await runReview(spec);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "review.published",
        comments: "already-posted",
        annotated: false,
      }),
    );
  });

  it("names a clean review nothing-to-post rather than already-posted", async () => {
    const { spec, entries } = makeRun();

    await runReview(spec);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "review.published",
        comments: "nothing-to-post",
      }),
    );
  });

  it("still reviews when the existing comments cannot be read", async () => {
    const { spec, client, entries } = makeRun([finding]);
    client.listReviewComments.mockRejectedValueOnce(new Error("boom"));

    await runReview(spec);

    expect(client.createReview).toHaveBeenCalledTimes(1);
    expect(entries).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "review.comments.list_failed",
      }),
    );
  });

  it("posts no review on a clean pull request", async () => {
    const { spec, client } = makeRun();

    await runReview(spec);

    expect(client.createReview).not.toHaveBeenCalled();
    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
  });
});

function postedThread(
  posted: ReviewFinding,
  flags: { isResolved?: boolean; isOutdated?: boolean } = {},
): ReviewThread {
  return {
    body: `**HIGH — Correctness: ${posted.title}**\n\n${findingMarker(posted)}\n<!-- pr-review-category: ${posted.category} -->`,
    isResolved: flags.isResolved ?? false,
    isOutdated: flags.isOutdated ?? false,
  };
}

function incrementalClient(
  client: ReturnType<typeof makeClient>,
  since: ChangedFile[],
): void {
  client.listPullRequestCommitShas.mockResolvedValue(["old111", target.headSha]);
  client.listCheckRuns.mockImplementation(async ({ sha }) =>
    sha === "old111"
      ? [{ name: "AI PR Review", status: "completed" }]
      : [],
  );
  client.compareCommits.mockResolvedValue({ status: "ahead", files: since });
}

describe("runReview, narrowed to the commits since the last review", () => {
  const sinceFile: ChangedFile = {
    filename: "src/sessions.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -2 +2,3 @@\n+const limit = 0;\n",
  };

  it("hands the agent the narrowed diff, and the whole pull request beside it", async () => {
    const { spec, client, agentRun } = makeRun([], {
      incremental: true,
    });
    incrementalClient(client, [sinceFile]);

    await runReview(spec);

    const context = agentRun.mock.calls[0]?.[0];
    expect(context).toMatchObject({
      changedFiles: [sinceFile],
      incremental: { sinceSha: "old111", diff, changedFiles },
    });
    expect(context?.diff).toContain("+const limit = 0;");
  });

  it("reviews the whole pull request when no earlier commit was reviewed", async () => {
    const { spec, client, agentRun } = makeRun([], {
      incremental: true,
    });
    client.listPullRequestCommitShas.mockResolvedValue([target.headSha]);

    await runReview(spec);

    expect(agentRun.mock.calls[0]?.[0]).toMatchObject({
      changedFiles,
      diff,
    });
    expect(agentRun.mock.calls[0]?.[0].incremental).toBeUndefined();
  });

  it("runs nothing when nothing this pull request changed has moved", async () => {
    const { spec, client, agentRun, entries } = makeRun([], { incremental: true });
    incrementalClient(client, []);

    await runReview(spec);

    expect(agentRun).not.toHaveBeenCalled();
    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "review.incremental.no_changes" }),
    );
  });

  it("lists an open finding from an earlier commit on the check run", async () => {
    const { spec, client } = makeRun([], { incremental: true });
    incrementalClient(client, []);
    client.listReviewThreads.mockResolvedValue([postedThread(finding)]);

    await runReview(spec);

    const published = client.createCheckRun.mock.calls[0]?.[0];
    expect(published).toMatchObject({ conclusion: "neutral" });
    expect(published?.output.title).toBe("1 finding open from earlier commits");
    expect(published?.output.summary).toContain(finding.title);
  });

  it("leaves out a finding the pull request already resolved", async () => {
    const { spec, client } = makeRun([], { incremental: true });
    incrementalClient(client, []);
    client.listReviewThreads.mockResolvedValue([
      postedThread(finding, { isResolved: true }),
    ]);

    await runReview(spec);

    expect(client.createCheckRun.mock.calls[0]?.[0]).toMatchObject({
      conclusion: "success",
    });
  });

  it("does not list a finding this run reported again", async () => {
    const { spec, client } = makeRun([finding], {
      incremental: true,
    });
    incrementalClient(client, [sinceFile]);
    client.listReviewThreads.mockResolvedValue([postedThread(finding)]);

    await runReview(spec);

    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).not.toContain("still open from earlier commits");
  });

  it("validates against the narrowed scope, not the whole pull request", async () => {
    const limits: ChangedFile = {
      filename: "src/limits.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      patch: "@@ -0,0 +1 @@\n+export const limit = 0;",
    };
    const earlier = { ...finding, file: limits.filename, line: 1, title: "Limit of zero" };
    const { spec, client } = makeRun([earlier, finding], { incremental: true });
    client.listChangedFiles.mockResolvedValue([...changedFiles, limits]);
    incrementalClient(client, [sinceFile]);

    const { outcome } = await runReview(spec);

    expect(outcome.candidates).toEqual([earlier, finding]);
    expect(outcome.findings).toEqual([finding]);
  });

  it("says on the check run that it read less than the whole pull request", async () => {
    const { spec, client } = makeRun([], { incremental: true });
    incrementalClient(client, [sinceFile]);

    await runReview(spec);

    expect(client.createCheckRun.mock.calls[0]?.[0].output.summary).toContain(
      "changed since `old111`",
    );
  });
});

describe("runReview: fixes", () => {
  describe("fixes", () => {
    const patchedFiles: ChangedFile[] = [
      {
        filename: "src/sessions.ts",
        status: "modified",
        additions: 2,
        deletions: 0,
        patch: ["@@ -0,0 +1,2 @@", "+const a = 1;", "+const b = 2;"].join("\n"),
      },
    ];
    const contents = "const a = 1;\nconst b = 2;\n";
    const patchedFinding: ReviewFinding = {
      ...finding,
      line: 1,
      patch: {
        startLine: 1,
        endLine: 1,
        expected: "const a = 1;",
        replacement: "const a = 0;",
      },
    };

    function makeFixDeps(commitFixes: boolean) {
      const made = makeRun([patchedFinding], {
        commitFixes,
      });
      made.client.listChangedFiles.mockResolvedValue(patchedFiles);
      made.client.getFileContents.mockResolvedValue(contents);
      return made;
    }

    it("commits the verified patch when fixes are enabled", async () => {
      const { spec, client } = makeFixDeps(true);

      await runReview(spec);

      expect(client.createCommitOnBranch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          branch: "feature/rate-limit",
          baseSha: target.headSha,
          files: [{ path: "src/sessions.ts", content: "const a = 0;\nconst b = 2;\n" }],
        }),
      );
      const review = client.createReview.mock.calls[0]?.[0];
      expect(review?.body).toContain("1 fix committed to this branch");
      expect(review?.comments[0]?.body).not.toContain("```suggestion");
    });

    it("offers the patch as a suggestion when fixes are disabled", async () => {
      const { spec, client } = makeFixDeps(false);

      await runReview(spec);

      expect(client.createCommitOnBranch).not.toHaveBeenCalled();
      const review = client.createReview.mock.calls[0]?.[0];
      expect(review?.comments[0]?.body).toContain("```suggestion\nconst a = 0;\n```");
      expect(review?.body).toContain("offered as suggested changes");
    });

    it("publishes the finding without its patch when the file does not match", async () => {
      const { spec, client } = makeFixDeps(true);
      client.getFileContents.mockResolvedValue("const a = 99;\nconst b = 2;\n");

      await runReview(spec);

      expect(client.createCommitOnBranch).not.toHaveBeenCalled();
      const review = client.createReview.mock.calls[0]?.[0];
      expect(review?.comments[0]?.body).toContain(patchedFinding.title);
      expect(review?.comments[0]?.body).not.toContain("```suggestion");
    });

    it("does not commit when the branch moved during the review", async () => {
      const { spec, client } = makeFixDeps(true);
      client.getBranchTip.mockResolvedValue("movedon1");

      await runReview(spec);

      expect(client.createCommitOnBranch).not.toHaveBeenCalled();
      const review = client.createReview.mock.calls[0]?.[0];
      expect(review?.comments[0]?.body).toContain("```suggestion");
      expect(review?.body).toContain("the branch moved during the review");
    });
  });
});


const NOW = new Date("2026-09-13T12:00:00.000Z");

/** A memory file holding one shape, built through the schema the reader parses. */
function memoryFile(overrides: Partial<MemoryShape> = {}): string {
  return JSON.stringify(
    reviewMemorySchema.parse({
      version: 1,
      shapes: [
        {
          category: "correctness",
          shape: "assignment instead of comparison in",
          resolved: 0,
          ignored: 5,
          outdated: 0,
          lastSignalAt: NOW.toISOString(),
          ...overrides,
        },
      ],
    }),
  );
}

function readOnlyStore(content: string): MemoryStore {
  return {
    read: () => Promise.resolve(content),
    write: () => Promise.resolve(),
  };
}

describe("runReview: repository hints", () => {
  it("hands the engine an agent carrying the memory's qualifying shapes", async () => {
    const { spec, requests } = makeRun([], {
      memoryStore: readOnlyStore(memoryFile()),
      now: () => NOW,
    });

    await runReview(spec);

    const agent = requests[0]?.agent;
    expect(agent?.repositoryHints).toHaveLength(1);
    expect(agent?.repositoryHints?.[0]).toContain(
      '"assignment instead of comparison in"',
    );
  });

  it("logs how many hints reached the agent", async () => {
    const { spec, entries } = makeRun([], {
      memoryStore: readOnlyStore(memoryFile()),
      now: () => NOW,
    });

    await runReview(spec);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "memory.hints_attached",
        repository: "octo-org/example-service",
        hintCount: 1,
      }),
    );
  });

  it("logs an empty attachment when no shape qualifies", async () => {
    const { spec, requests, entries } = makeRun([], {
      memoryStore: readOnlyStore(memoryFile({ ignored: 1 })),
      now: () => NOW,
    });

    await runReview(spec);

    const agent = requests[0]?.agent;
    expect(agent?.repositoryHints).toBeUndefined();
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "memory.hints_attached", hintCount: 0 }),
    );
  });

  it("passes the agent through untouched when there is no memory store", async () => {
    const { spec, requests, entries } = makeRun();

    await runReview(spec);

    expect(requests[0]?.agent).toBe(GENERAL_AGENT);
    expect(entries.map((entry) => entry["event"])).not.toContain(
      "memory.hints_attached",
    );
  });

  it("reviews without hints when the memory cannot be read", async () => {
    const { spec, client, requests, entries } = makeRun([finding], {
      memoryStore: {
        read: () => Promise.reject(new Error("branch unreachable")),
        write: () => Promise.resolve(),
      },
    });

    await runReview(spec);

    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
    expect(requests[0]?.agent).toBe(GENERAL_AGENT);
    // readMemory absorbs the transport error, so it surfaces as memory.invalid.
    expect(entries).toContainEqual(
      expect.objectContaining({ level: "error", event: "memory.invalid" }),
    );
  });
});

describe("the repository index", () => {
  /** The index the engine was handed, if any. */
  function indexPassedTo(
    requests: readonly AgentRequest[],
  ): RepositoryIndex | undefined {
    return requests[0]?.index;
  }

  function entry(entries: ReturnType<typeof makeRun>["entries"], event: string) {
    return entries.find((logged) => logged["event"] === event);
  }

  it("builds it from the base commit, never the head", async () => {
    const { spec, client, requests, entries } = makeRun();

    await runReview(spec);

    expect(client.getRepositoryArchive).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      ref: pullRequest.baseSha,
    });
    expect(indexPassedTo(requests)?.sha).toBe(pullRequest.baseSha);
    expect(entry(entries, "index.built")).toMatchObject({
      sha: pullRequest.baseSha,
      files: baseFiles.size,
      truncated: false,
    });
  });

  it("pairs the changed source file with its test", async () => {
    const { spec, requests } = makeRun();

    await runReview(spec);

    expect(
      indexPassedTo(requests)?.files.get("src/sessions.ts")?.coveredBy,
    ).toBe("src/sessions.test.ts");
  });

  it("skips the archive entirely when the index is off", async () => {
    const { spec, client, requests, entries } = makeRun([], { index: false });

    await runReview(spec);

    expect(client.getRepositoryArchive).not.toHaveBeenCalled();
    expect(indexPassedTo(requests)).toBeUndefined();
    expect(entry(entries, "index.skipped")).toBeDefined();
    expect(entry(entries, "index.built")).toBeUndefined();
  });

  it("completes the review when the archive fails", async () => {
    const { spec, client, agentRun, requests, entries } = makeRun();
    client.getRepositoryArchive.mockRejectedValue(new Error("archive too large"));

    await expect(runReview(spec)).resolves.toBeDefined();

    expect(agentRun).toHaveBeenCalledTimes(1);
    expect(indexPassedTo(requests)).toBeUndefined();
    expect(entry(entries, "index.failed")).toMatchObject({
      reason: "archive too large",
      level: "error",
    });
  });

  it("reviews without an index when the archive is too large to inflate", async () => {
    const { spec, client, requests, entries } = makeRun();
    client.getRepositoryArchive.mockRejectedValue(
      new ArchiveTooLargeError("the repository archive inflates past the cap"),
    );

    await expect(runReview(spec)).resolves.toBeDefined();

    expect(indexPassedTo(requests)).toBeUndefined();
    expect(entry(entries, "index.failed")).toMatchObject({
      reason: "the repository archive inflates past the cap",
      fallback: "reviewing without the repository index",
    });
  });

  it("carries the archive's truncation through to the index", async () => {
    const { spec, client, requests, entries } = makeRun();
    client.getRepositoryArchive.mockResolvedValue({
      sha: pullRequest.baseSha,
      files: new Map(baseFiles),
      truncated: true,
    });

    await runReview(spec);

    expect(indexPassedTo(requests)?.truncated).toBe(true);
    expect(entry(entries, "index.built")).toMatchObject({ truncated: true });
  });

  it("leads the check run with the blast radius it scored", async () => {
    const { spec, client, entries } = makeRun();

    await runReview(spec);

    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).toMatch(/^\*\*Blast radius: Low \(\d+\)\*\*/);
    expect(entry(entries, "risk.scored")).toMatchObject({
      band: "low",
      durationMs: expect.any(Number),
    });
  });

  it("carries the blast radius it published onto the outcome", async () => {
    const { spec, client } = makeRun();

    const { blastRadius } = (await runReview(spec)).outcome;

    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(blastRadius?.risk.band).toBe("low");
    expect(summary).toContain(`Blast radius: Low (${blastRadius?.risk.score})`);
    // Only a test imports the changed file, and tests are not dependents.
    expect(blastRadius?.impact.counts.transitive).toBe(0);
  });

  it("publishes no blast radius when the index is off", async () => {
    const { spec, client, entries } = makeRun([], { index: false });

    await runReview(spec);

    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).not.toContain("Blast radius");
    expect(entry(entries, "risk.scored")).toBeUndefined();
  });
});

describe("suggested reviewers", () => {
  const blamed: BlameRange[] = [
    {
      startLine: 1,
      endLine: 1,
      login: "alice",
      author: "Alice",
      committedAt: "2026-09-01T10:00:00.000Z",
    },
  ];

  function withCodeowners(client: ReturnType<typeof makeRun>["client"]) {
    client.getRepositoryArchive.mockResolvedValue({
      sha: pullRequest.baseSha,
      files: new Map([...baseFiles, [".github/CODEOWNERS", "* @org/api-team @octocat"]]),
      truncated: false,
    });
  }

  it("names them on the check run, under the blast radius", async () => {
    const { spec, client, entries } = makeRun([finding]);
    client.blame.mockResolvedValue(blamed);
    withCodeowners(client);

    await runReview(spec);

    expect(client.blame).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      ref: pullRequest.baseSha,
      path: "src/sessions.ts",
    });
    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).toMatch(/^\*\*Blast radius: /);
    expect(summary).toContain(
      "<sub>Static imports only.</sub>\n\n" +
        "**Suggested reviewers:** @alice (100% of changed lines) · @org/api-team (CODEOWNERS)" +
        "\n\n**1 finding**",
    );
    expect(
      entries.find((entry) => entry["event"] === "reviewers.suggested"),
    ).toMatchObject({ count: 2, durationMs: expect.any(Number) });
  });

  it("still suggests from blame with the index off", async () => {
    const { spec, client } = makeRun([], { index: false });
    client.blame.mockResolvedValue(blamed);

    await runReview(spec);

    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).toMatch(
      /^\*\*Suggested reviewers:\*\* @alice \(100% of changed lines\)\n\n/,
    );
  });

  it("blames nothing and names nobody when switched off", async () => {
    const { spec, client } = makeRun([], {
      suggestReviewers: false,
    });
    client.blame.mockResolvedValue(blamed);
    withCodeowners(client);

    await runReview(spec);

    expect(client.blame).not.toHaveBeenCalled();
    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).not.toContain("Suggested reviewers");
  });

  it("publishes the review when blame fails", async () => {
    const { spec, client, entries } = makeRun();
    client.blame.mockRejectedValue(new Error("GraphQL is down"));

    await runReview(spec);

    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).not.toContain("Suggested reviewers");
    expect(
      entries.find((entry) => entry["event"] === "reviewers.blame_failed"),
    ).toMatchObject({ reason: "GraphQL is down" });
  });
});

describe("cancellation", () => {
  function entry(entries: ReturnType<typeof makeRun>["entries"], event: string) {
    return entries.find((logged) => logged["event"] === event);
  }

  it("puts the caller's signal on the context the agent receives", async () => {
    const controller = new AbortController();
    const { spec, agentRun } = makeRun();

    await runReview({ ...spec, signal: controller.signal });

    expect(agentRun.mock.calls[0]?.[0]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("never starts a review whose signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { spec, client, agentRun, entries } = makeRun();

    await expect(
      runReview({ ...spec, signal: controller.signal }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(client.getPullRequest).not.toHaveBeenCalled();
    expect(agentRun).not.toHaveBeenCalled();
    expect(entry(entries, "review.cancelled")).toMatchObject({
      stage: "before start",
    });
  });

  it("publishes nothing when the agent is cancelled mid-run", async () => {
    const controller = new AbortController();
    const { spec, client, agentRun, entries } = makeRun();
    agentRun.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expect(
      runReview({ ...spec, signal: controller.signal }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(client.createReview).not.toHaveBeenCalled();
    expect(entry(entries, "review.cancelled")).toMatchObject({
      stage: "agent",
    });
  });

  it("publishes nothing when the cancellation lands after the agents finished", async () => {
    const controller = new AbortController();
    const { spec, client, agentRun } = makeRun([finding]);
    agentRun.mockImplementationOnce(async () => {
      controller.abort();
      return [finding];
    });

    await expect(
      runReview({ ...spec, signal: controller.signal }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(client.createReview).not.toHaveBeenCalled();
  });

  it("completes normally while the signal stays live", async () => {
    const { spec } = makeRun([finding]);

    const { outcome } = await runReview({
      ...spec,
      signal: new AbortController().signal,
    });

    expect(outcome.findings).toEqual([finding]);
  });

  it("asks whether the run is still wanted before each write", async () => {
    const stillRunning = vi.fn(async () => true);
    const { spec, client } = makeRun([finding]);

    await runReview({ ...spec, stillRunning });

    expect(writesOf(client)).toBe(2);
    expect(stillRunning).toHaveBeenCalledTimes(2);
  });

  it("writes nothing, and mirrors nothing, once the run is no longer wanted", async () => {
    const { delivery, recorded } = recordingDelivery();
    const { spec, client, entries } = makeRun([finding]);

    await expect(
      runReview({ ...spec, delivery, stillRunning: async () => false }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(writesOf(client)).toBe(0);
    expect(recorded).toEqual({ checkRun: undefined, review: undefined, runs: [] });
    expect(entry(entries, "review.cancelled")).toMatchObject({
      stage: "before publish",
    });
  });

  it("publishes no incremental check run once the run is no longer wanted", async () => {
    const { spec, client } = makeRun([], { incremental: true });
    incrementalClient(client, []);

    await expect(
      runReview({ ...spec, stillRunning: async () => false }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(writesOf(client)).toBe(0);
  });
});

/** A memory file whose only content is one suppression. */
function suppressionFile(title: string): string {
  return JSON.stringify(
    reviewMemorySchema.parse({
      version: 1,
      shapes: [],
      suppressions: [
        {
          category: "correctness",
          shape: titleShape(title),
          title,
          createdAt: NOW.toISOString(),
        },
      ],
    }),
  );
}

describe("runReview: suppressions", () => {
  it("excludes a suppressed finding and reports how many it hid", async () => {
    const elsewhere = { ...finding, title: "Assignment instead of comparison in isAdmin" };
    const { spec, client, entries } = makeRun([elsewhere], {
      memoryStore: readOnlyStore(suppressionFile("Assignment instead of comparison in hasAccess")),
      now: () => NOW,
    });

    const { outcome } = await runReview(spec);

    expect(outcome.findings).toEqual([]);
    expect(outcome.suppressed).toBe(1);
    expect(client.createReview).not.toHaveBeenCalled();
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "findings.suppressed", suppressedCount: 1 }),
    );
  });

  it("publishes a finding the suppression no longer matches", async () => {
    const { spec, client, entries } = makeRun([finding], {
      memoryStore: readOnlyStore(suppressionFile("Unbounded query in the session list")),
      now: () => NOW,
    });

    const { outcome } = await runReview(spec);

    expect(outcome.findings).toEqual([finding]);
    expect(outcome.suppressed).toBe(0);
    expect(client.createReview).toHaveBeenCalledTimes(1);
    expect(entries.map((entry) => entry["event"])).not.toContain("findings.suppressed");
  });
});

describe("runReview: delivery adapters", () => {
  it("writes nothing through a publish-capable client when the delivery records", async () => {
    const { delivery, recorded } = recordingDelivery();
    const { spec, client } = makeRun([finding]);

    const { outcome } = await runReview({ ...spec, delivery });

    expect(writesOf(client)).toBe(0);
    expect(recorded.checkRun?.conclusion).toBe("neutral");
    expect(recorded.review?.comments).toHaveLength(1);
    expect(outcome.findings).toEqual([finding]);
  });

  it("mirrors the finished run to the dashboard adapter", async () => {
    const published: ReviewRecord[] = [];
    const { delivery, recorded } = recordingDelivery();
    const { spec } = makeRun([finding]);

    const run = await runReview({
      ...spec,
      delivery: dashboardDelivery(
        delivery,
        async (_target, record) => {
          published.push(record);
        },
        createCapturingLogger().logger,
      ),
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.findings).toEqual([{ ...finding, hasPatch: false }]);
    expect(published[0]?.summary).toBe("1 finding");
    expect(recorded.runs[0]).toBe(run);
  });

  it("gives the GitHub adapter a committer only when asked", () => {
    const client = makeClient();
    const { logger } = createCapturingLogger();
    const without: ReviewDelivery = githubDelivery({ client, logger });
    const with_: ReviewDelivery = githubDelivery({
      client,
      logger,
      commitFixes: true,
    });

    expect(without.publishFixes).toBeUndefined();
    expect(with_.publishFixes).toBeDefined();
  });

  it("never offers a committer from the recording adapter", () => {
    expect(recordingDelivery().delivery.publishFixes).toBeUndefined();
  });

  it("refuses a run that names no delivery", () => {
    const { spec } = makeRun();
    const { delivery: _delivery, ...withoutDelivery } = spec;

    // @ts-expect-error a run has no delivery to fall back on.
    const typed: ReviewRunSpec = withoutDelivery;
    expect(typed.delivery).toBeUndefined();
  });

  it("refuses a clock without a memory store to age", () => {
    const memory = { now: () => NOW };

    // @ts-expect-error `store` is what makes a clock mean anything.
    const typed: ReviewMemory = memory;
    expect(typed.now?.()).toEqual(NOW);
  });
});
