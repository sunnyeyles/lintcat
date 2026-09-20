import {
  emptyTokenUsage,
  ReviewCancelledError,
  type AgentDefinition,
} from "@pr-review/ai";
import { ArchiveTooLargeError } from "@pr-review/github";
import type {
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
import type { RepositoryIndex } from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import {
  reviewMemorySchema,
  type MemoryShape,
  type ReviewFinding,
} from "@pr-review/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { titleShape, type MemoryStore } from "#src/memory";
import type { ReviewPipelineRun } from "#src/pipeline-runner";
import type { PublishReview } from "#src/publish-review";
import { findingMarker } from "#src/render-review";
import {
  skippedSynthesis,
  type ReviewPipelineResult,
} from "#src/review-pipeline";
import { githubDelivery } from "#src/review-delivery";
import { reviewWithDelivery } from "#src/review-pull-request";
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
    patch: "@@ -1 +1,2 @@",
  },
];

const diff = "diff --git a/src/sessions.ts b/src/sessions.ts\n";

/** The tree the fake archive serves at the base commit. */
const baseFiles = new Map<string, string>([
  ["src/sessions.ts", "export const sessions = [];\n"],
  ["src/sessions.test.ts", "import './sessions';\n"],
]);

const finding: ReviewFinding = {
  file: "src/sessions.ts",
  line: 2,
  category: "correctness",
  severity: "high",
  title: "Assignment instead of comparison in admin check",
  explanation:
    "The if condition assigns true to user.isAdmin instead of comparing, so every user passes the check.",
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

function reviewResult(
  overrides: Partial<ReviewPipelineResult> = {},
): ReviewPipelineResult {
  const candidates = overrides.candidates ?? [];
  return {
    candidates,
    agentFailures: [],
    synthesis:
      candidates.length === 0
        ? skippedSynthesis("no candidate findings", [])
        : {
            outcome: "completed",
            candidates,
            usage: emptyTokenUsage(),
            durationMs: 0,
          },
    findings: candidates as ReviewFinding[],
    ...overrides,
  };
}

/** An agent definition; `paths` is what the gate reads. */
function makeAgent(
  category: string,
  paths?: readonly string[],
): AgentDefinition {
  return {
    category,
    role: `${category} reviewer`,
    focus: `Review only for ${category} problems.`,
    ...(paths === undefined ? {} : { paths }),
  };
}

interface DepsOptions {
  agents?: readonly AgentDefinition[];
  /** Replaces the GitHub adapter's check-run publisher, as the fork fallback does. */
  publishReview?: PublishReview;
  commitFixes?: boolean;
  memoryStore?: MemoryStore;
  now?: () => Date;
  incremental?: boolean;
  index?: boolean;
}

function makeDeps(
  review: ReviewPipelineResult = reviewResult(),
  {
    agents = [makeAgent("correctness")],
    publishReview,
    commitFixes = false,
    ...options
  }: DepsOptions = {},
) {
  const client = makeClient();
  const runReviewPipeline = vi.fn(async (_run: ReviewPipelineRun) => review);
  const { logger, entries } = createCapturingLogger();
  const github = githubDelivery({ client, logger, commitFixes });
  return {
    client,
    runReviewPipeline,
    entries,
    deps: {
      client,
      agents,
      runReviewPipeline,
      logger,
      delivery:
        publishReview === undefined
          ? github
          : { ...github, publishCheckRun: publishReview },
      ...options,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reviewWithDelivery", () => {
  it("loads the PR, its changed files, and its diff concurrently", async () => {
    const { deps, client } = makeDeps();

    await reviewWithDelivery(target, deps);

    expect(client.getPullRequest).toHaveBeenCalledExactlyOnceWith(target);
    expect(client.listChangedFiles).toHaveBeenCalledExactlyOnceWith(target);
    expect(client.getDiff).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("runs the pipeline against the loaded context with the same client", async () => {
    const agents = [makeAgent("correctness")];
    const { deps, client, runReviewPipeline } = makeDeps(reviewResult(), {
      agents,
    });

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline).toHaveBeenCalledExactlyOnceWith({
      client,
      context: {
        owner: target.owner,
        repo: target.repo,
        pullRequest,
        changedFiles,
        diff,
      },
      agents,
      hints: { keep: [], drop: [] },
      index: expect.objectContaining({ sha: pullRequest.baseSha }),
    });
  });

  it("publishes a check run through the GitHub adapter", async () => {
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }));

    await reviewWithDelivery(target, deps);

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
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }), {
      publishReview,
    });

    await reviewWithDelivery(target, deps);

    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(publishReview).toHaveBeenCalledTimes(1);
    const [publishedTarget, rendered] = publishReview.mock.calls[0] ?? [];
    expect(publishedTarget).toEqual(target);
    expect(rendered?.output.summary).toContain(finding.title);
  });

  it("returns the pipeline result so callers can inspect the review", async () => {
    const review = reviewResult({ candidates: [finding] });
    const { deps } = makeDeps(review);

    // Not the same object: patch verification may strip an unprovable patch,
    // and it adds its own tally.
    await expect(reviewWithDelivery(target, deps)).resolves.toEqual({
      ...review,
      patches: { proposed: 0, verified: 0 },
      suppressed: 0,
    });
  });

  it("emits the lifecycle events for one review (spec §26)", async () => {
    const { deps, entries } = makeDeps(reviewResult({ candidates: [finding] }));

    await reviewWithDelivery(target, deps);

    expect(entries.map((entry) => entry["event"])).toEqual([
      "review.loaded",
      "index.built",
      "synthesis.started",
      "synthesis.completed",
      "findings.validated",
      "patches.verified",
      "review.comments.published",
      "review.published",
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({ repository: "octo-org/example-service" });
    }
  });

  it("logs synthesis.skipped for a clean review rather than a synthesis pair", async () => {
    const { deps, entries } = makeDeps();

    await reviewWithDelivery(target, deps);

    const events = entries.map((entry) => entry["event"]);
    expect(events).toContain("synthesis.skipped");
    expect(events).not.toContain("synthesis.started");
  });

  it("logs synthesis.failed and still publishes when synthesis fails", async () => {
    const { deps, client, entries } = makeDeps(
      reviewResult({
        candidates: [finding],
        synthesis: {
          outcome: "failed",
          candidates: [finding],
          error: "model returned malformed JSON",
          errorName: "SynthesisError",
          durationMs: 0,
        },
      }),
    );

    await reviewWithDelivery(target, deps);

    expect(entries).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "synthesis.failed",
        fallback: "publishing validated raw findings",
      }),
    );
    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
  });

  it("propagates a pipeline failure without publishing", async () => {
    const { deps, client, runReviewPipeline } = makeDeps();
    runReviewPipeline.mockRejectedValueOnce(new Error("every agent failed"));

    await expect(reviewWithDelivery(target, deps)).rejects.toThrow(
      "every agent failed",
    );
    expect(client.createCheckRun).not.toHaveBeenCalled();
  });

  it("propagates a publish failure so the caller decides on retry", async () => {
    const publishReview = vi.fn<PublishReview>(async () => {
      throw new Error("check run rejected");
    });
    const { deps, entries } = makeDeps(reviewResult(), { publishReview });

    await expect(reviewWithDelivery(target, deps)).rejects.toThrow(
      "check run rejected",
    );
    expect(entries.map((entry) => entry["event"])).not.toContain(
      "review.published",
    );
  });
});

describe("reviewWithDelivery inline comments", () => {
  it("publishes a review through the GitHub adapter", async () => {
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }));

    await reviewWithDelivery(target, deps);

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
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }));

    await reviewWithDelivery(target, deps);

    expect(
      client.createCheckRun.mock.calls[0]?.[0].output.annotations,
    ).toBeUndefined();
  });

  it("keeps the annotations when the token cannot post comments", async () => {
    const { deps, client, entries } = makeDeps(
      reviewResult({ candidates: [finding] }),
    );
    client.createReview.mockRejectedValueOnce(permissionError(403));

    await reviewWithDelivery(target, deps);

    expect(
      client.createCheckRun.mock.calls[0]?.[0].output.annotations,
    ).toHaveLength(1);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "review.comments.degraded", status: 403 }),
    );
  });

  it("fails the run on a comment error that is not a permission error", async () => {
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }));
    client.createReview.mockRejectedValueOnce(permissionError(500));

    await expect(reviewWithDelivery(target, deps)).rejects.toThrow("boom");
    expect(client.createCheckRun).not.toHaveBeenCalled();
  });

  it("does not repeat a finding already commented on an earlier commit", async () => {
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }));
    client.listReviewComments.mockResolvedValueOnce([
      { body: `stale text\n\n${findingMarker(finding)}` },
    ]);

    await reviewWithDelivery(target, deps);

    expect(client.createReview).not.toHaveBeenCalled();
  });

  it("does not re-annotate a finding whose earlier comment still stands", async () => {
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }));
    client.listReviewComments.mockResolvedValueOnce([
      { body: `stale text\n\n${findingMarker(finding)}` },
    ]);

    await reviewWithDelivery(target, deps);

    expect(
      client.createCheckRun.mock.calls[0]?.[0].output.annotations,
    ).toBeUndefined();
  });

  it("names the dedupe as its own outcome, not a failure to post", async () => {
    const { deps, client, entries } = makeDeps(
      reviewResult({ candidates: [finding] }),
    );
    client.listReviewComments.mockResolvedValueOnce([
      { body: `stale text\n\n${findingMarker(finding)}` },
    ]);

    await reviewWithDelivery(target, deps);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "review.published",
        comments: "already-posted",
        annotated: false,
      }),
    );
  });

  it("names a clean review nothing-to-post rather than already-posted", async () => {
    const { deps, entries } = makeDeps();

    await reviewWithDelivery(target, deps);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "review.published",
        comments: "nothing-to-post",
      }),
    );
  });

  it("still reviews when the existing comments cannot be read", async () => {
    const { deps, client, entries } = makeDeps(
      reviewResult({ candidates: [finding] }),
    );
    client.listReviewComments.mockRejectedValueOnce(new Error("boom"));

    await reviewWithDelivery(target, deps);

    expect(client.createReview).toHaveBeenCalledTimes(1);
    expect(entries).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "review.comments.list_failed",
      }),
    );
  });

  it("posts no review on a clean pull request", async () => {
    const { deps, client } = makeDeps();

    await reviewWithDelivery(target, deps);

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

describe("reviewWithDelivery, narrowed to the commits since the last review", () => {
  const sinceFile: ChangedFile = {
    filename: "src/sessions.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -2 +2,3 @@\n+const limit = 0;\n",
  };

  it("hands the agents the narrowed diff, and the whole pull request beside it", async () => {
    const { deps, client, runReviewPipeline } = makeDeps(reviewResult(), {
      incremental: true,
    });
    incrementalClient(client, [sinceFile]);

    await reviewWithDelivery(target, deps);

    const context = runReviewPipeline.mock.calls[0]?.[0].context;
    expect(context).toMatchObject({
      changedFiles: [sinceFile],
      incremental: { sinceSha: "old111", diff, changedFiles },
    });
    expect(context?.diff).toContain("+const limit = 0;");
  });

  it("reviews the whole pull request when no earlier commit was reviewed", async () => {
    const { deps, client, runReviewPipeline } = makeDeps(reviewResult(), {
      incremental: true,
    });
    client.listPullRequestCommitShas.mockResolvedValue([target.headSha]);

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline.mock.calls[0]?.[0].context).toMatchObject({
      changedFiles,
      diff,
    });
    expect(runReviewPipeline.mock.calls[0]?.[0].context.incremental).toBeUndefined();
  });

  it("runs no agent when nothing this pull request changed has moved", async () => {
    const { deps, client, runReviewPipeline, entries } = makeDeps(
      reviewResult(),
      { incremental: true },
    );
    incrementalClient(client, []);

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline).not.toHaveBeenCalled();
    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "review.incremental.no_changes" }),
    );
  });

  it("lists an open finding from an earlier commit on the check run", async () => {
    const { deps, client } = makeDeps(reviewResult(), { incremental: true });
    incrementalClient(client, []);
    client.listReviewThreads.mockResolvedValue([postedThread(finding)]);

    await reviewWithDelivery(target, deps);

    const published = client.createCheckRun.mock.calls[0]?.[0];
    expect(published).toMatchObject({ conclusion: "neutral" });
    expect(published?.output.title).toBe("1 finding open from earlier commits");
    expect(published?.output.summary).toContain(finding.title);
  });

  it("leaves out a finding the pull request already resolved", async () => {
    const { deps, client } = makeDeps(reviewResult(), { incremental: true });
    incrementalClient(client, []);
    client.listReviewThreads.mockResolvedValue([
      postedThread(finding, { isResolved: true }),
    ]);

    await reviewWithDelivery(target, deps);

    expect(client.createCheckRun.mock.calls[0]?.[0]).toMatchObject({
      conclusion: "success",
    });
  });

  it("does not list a finding this run reported again", async () => {
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }), {
      incremental: true,
    });
    incrementalClient(client, [sinceFile]);
    client.listReviewThreads.mockResolvedValue([postedThread(finding)]);

    await reviewWithDelivery(target, deps);

    const summary = client.createCheckRun.mock.calls[0]?.[0].output.summary;
    expect(summary).not.toContain("still open from earlier commits");
  });

  it("says on the check run that it read less than the whole pull request", async () => {
    const { deps, client } = makeDeps(reviewResult(), { incremental: true });
    incrementalClient(client, [sinceFile]);

    await reviewWithDelivery(target, deps);

    expect(client.createCheckRun.mock.calls[0]?.[0].output.summary).toContain(
      "changed since `old111`",
    );
  });
});

/**
 * The changed file every fixture carries is `src/sessions.ts`, so
 * `packages/**` is the pattern nothing here matches.
 */
describe("reviewWithDelivery: path filters", () => {
  const gated = makeAgent("security", ["packages/**"]);
  const ungated = makeAgent("correctness");

  it("hands the pipeline only the agents the changed files woke", async () => {
    const { deps, runReviewPipeline } = makeDeps(reviewResult(), {
      agents: [ungated, gated],
    });

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline.mock.calls[0]?.[0].agents).toEqual([ungated]);
  });

  it("wakes an agent whose pattern one changed file matches", async () => {
    const matching = makeAgent("security", ["src/**"]);
    const { deps, runReviewPipeline } = makeDeps(reviewResult(), {
      agents: [matching],
    });

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline.mock.calls[0]?.[0].agents).toEqual([matching]);
  });

  it("logs each skipped agent with the paths it waited for", async () => {
    const { deps, entries } = makeDeps(reviewResult(), {
      agents: [ungated, gated],
    });

    await reviewWithDelivery(target, deps);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "agent.skipped",
        agent: "security",
        paths: ["packages/**"],
        repository: "octo-org/example-service",
      }),
    );
  });

  it("names the skipped agent in the published check run", async () => {
    const { deps, client } = makeDeps(reviewResult({ candidates: [finding] }), {
      agents: [ungated, gated],
    });

    await reviewWithDelivery(target, deps);

    expect(client.createCheckRun.mock.calls[0]?.[0].output.summary).toMatch(
      /security review did not run/i,
    );
  });

  describe("when no agent matches", () => {
    const only = { agents: [gated] };

    it("never calls the pipeline, so the review costs nothing", async () => {
      const { deps, runReviewPipeline } = makeDeps(reviewResult(), only);

      await reviewWithDelivery(target, deps);

      expect(runReviewPipeline).not.toHaveBeenCalled();
    });

    it("still publishes a check run, and never a green one", async () => {
      // The whole point: a pull request nothing reviewed must not be
      // indistinguishable from one that came back clean.
      const { deps, client } = makeDeps(reviewResult(), only);

      await reviewWithDelivery(target, deps);

      const published = client.createCheckRun.mock.calls[0]?.[0];
      expect(published?.conclusion).toBe("neutral");
      expect(published?.output.title).toBe(
        "No agent reviewed this pull request",
      );
      expect(published?.output.summary).toContain("`packages/**`");
      expect(published?.output.summary).toContain("`src/sessions.ts`");
    });

    it("posts no review comments", async () => {
      const { deps, client } = makeDeps(reviewResult(), only);

      await reviewWithDelivery(target, deps);

      expect(client.createReview).not.toHaveBeenCalled();
      expect(client.listReviewComments).not.toHaveBeenCalled();
    });

    it("reports the skip to the caller as an empty review", async () => {
      const { deps } = makeDeps(reviewResult(), only);

      await expect(reviewWithDelivery(target, deps)).resolves.toMatchObject({
        findings: [],
        candidates: [],
        agentFailures: [],
        synthesis: { outcome: "skipped" },
      });
    });

    it("logs the lifecycle of a review that never ran", async () => {
      const { deps, entries } = makeDeps(reviewResult(), only);

      await reviewWithDelivery(target, deps);

      expect(entries.map((entry) => entry["event"])).toEqual([
        "review.loaded",
        "agent.skipped",
        "review.no_agents_matched",
      ]);
    });

    it("publishes through the delivery, so the fork fallback still applies", async () => {
      const publishReview = vi.fn<PublishReview>(async () => undefined);
      const { deps, client } = makeDeps(reviewResult(), {
        ...only,
        publishReview,
      });

      await reviewWithDelivery(target, deps);

      expect(client.createCheckRun).not.toHaveBeenCalled();
      expect(publishReview).toHaveBeenCalledTimes(1);
    });
  });

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
      const made = makeDeps(reviewResult({ candidates: [patchedFinding] }), {
        commitFixes,
      });
      made.client.listChangedFiles.mockResolvedValue(patchedFiles);
      made.client.getFileContents.mockResolvedValue(contents);
      return made;
    }

    it("commits the verified patch when fixes are enabled", async () => {
      const { deps, client } = makeFixDeps(true);

      await reviewWithDelivery(target, deps);

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
      const { deps, client } = makeFixDeps(false);

      await reviewWithDelivery(target, deps);

      expect(client.createCommitOnBranch).not.toHaveBeenCalled();
      const review = client.createReview.mock.calls[0]?.[0];
      expect(review?.comments[0]?.body).toContain("```suggestion\nconst a = 0;\n```");
      expect(review?.body).toContain("offered as suggested changes");
    });

    it("publishes the finding without its patch when the file does not match", async () => {
      const { deps, client } = makeFixDeps(true);
      client.getFileContents.mockResolvedValue("const a = 99;\nconst b = 2;\n");

      await reviewWithDelivery(target, deps);

      expect(client.createCommitOnBranch).not.toHaveBeenCalled();
      const review = client.createReview.mock.calls[0]?.[0];
      expect(review?.comments[0]?.body).toContain(patchedFinding.title);
      expect(review?.comments[0]?.body).not.toContain("```suggestion");
    });

    it("does not commit when the branch moved during the review", async () => {
      const { deps, client } = makeFixDeps(true);
      client.getBranchTip.mockResolvedValue("movedon1");

      await reviewWithDelivery(target, deps);

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

describe("reviewWithDelivery: repository hints", () => {
  it("hands the pipeline agents carrying the memory's qualifying shapes", async () => {
    const { deps, runReviewPipeline } = makeDeps(reviewResult(), {
      memoryStore: readOnlyStore(memoryFile()),
      now: () => NOW,
    });

    await reviewWithDelivery(target, deps);

    const [hinted] = runReviewPipeline.mock.calls[0]?.[0].agents ?? [];
    expect(hinted?.repositoryHints).toHaveLength(1);
    expect(hinted?.repositoryHints?.[0]).toContain(
      '"assignment instead of comparison in"',
    );
  });

  it("logs which agents the hints reached", async () => {
    const { deps, entries } = makeDeps(reviewResult(), {
      memoryStore: readOnlyStore(memoryFile()),
      now: () => NOW,
    });

    await reviewWithDelivery(target, deps);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "memory.hints_attached",
        repository: "octo-org/example-service",
        hintCount: 1,
        agents: ["correctness"],
      }),
    );
  });

  it("logs an empty attachment when no shape qualifies", async () => {
    const { deps, runReviewPipeline, entries } = makeDeps(reviewResult(), {
      memoryStore: readOnlyStore(memoryFile({ ignored: 1 })),
      now: () => NOW,
    });

    await reviewWithDelivery(target, deps);

    const [unhinted] = runReviewPipeline.mock.calls[0]?.[0].agents ?? [];
    expect(unhinted?.repositoryHints).toBeUndefined();
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "memory.hints_attached",
        hintCount: 0,
        agents: [],
      }),
    );
  });

  it("passes the agents through untouched when there is no memory store", async () => {
    const agent = makeAgent("correctness");
    const { deps, runReviewPipeline, entries } = makeDeps(reviewResult(), {
      agents: [agent],
    });

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline.mock.calls[0]?.[0].agents?.[0]).toBe(agent);
    expect(entries.map((entry) => entry["event"])).not.toContain(
      "memory.hints_attached",
    );
  });

  it("reviews without hints when the memory cannot be read", async () => {
    const agent = makeAgent("correctness");
    const { deps, client, runReviewPipeline, entries } = makeDeps(
      reviewResult({ candidates: [finding] }),
      {
        agents: [agent],
        memoryStore: {
          read: () => Promise.reject(new Error("branch unreachable")),
          write: () => Promise.resolve(),
        },
      },
    );

    await reviewWithDelivery(target, deps);

    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
    expect(runReviewPipeline.mock.calls[0]?.[0].agents?.[0]).toBe(agent);
    // readMemory absorbs the transport error, so it surfaces as memory.invalid.
    expect(entries).toContainEqual(
      expect.objectContaining({ level: "error", event: "memory.invalid" }),
    );
  });
});

describe("reviewWithDelivery: orchestrator memory", () => {
  it("hands the pipeline the synthesis hints the memory earns", async () => {
    const { deps, runReviewPipeline, entries } = makeDeps(reviewResult(), {
      memoryStore: readOnlyStore(memoryFile()),
      now: () => NOW,
    });

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline.mock.calls[0]?.[0].hints).toEqual({
      keep: [],
      drop: ['Correctness: Findings like "assignment instead of comparison in".'],
    });
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "memory.hints_attached",
        synthesisKeepCount: 0,
        synthesisDropCount: 1,
      }),
    );
  });

  it("keeps a shape the repository has acted on", async () => {
    const { deps, runReviewPipeline } = makeDeps(reviewResult(), {
      memoryStore: readOnlyStore(memoryFile({ ignored: 0, resolved: 4 })),
      now: () => NOW,
    });

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline.mock.calls[0]?.[0].hints).toEqual({
      keep: ['Correctness: Findings like "assignment instead of comparison in".'],
      drop: [],
    });
  });

  it("synthesises unhinted when there is no memory store", async () => {
    const { deps, runReviewPipeline } = makeDeps(reviewResult());

    await reviewWithDelivery(target, deps);

    expect(runReviewPipeline.mock.calls[0]?.[0].hints).toEqual({ keep: [], drop: [] });
  });
});

describe("the repository index", () => {
  /** The index the pipeline was handed, if any. */
  function indexPassedTo(
    runReviewPipeline: ReturnType<typeof makeDeps>["runReviewPipeline"],
  ): RepositoryIndex | undefined {
    return runReviewPipeline.mock.calls[0]?.[0].index;
  }

  function entry(entries: ReturnType<typeof makeDeps>["entries"], event: string) {
    return entries.find((logged) => logged["event"] === event);
  }

  it("builds it from the base commit, never the head", async () => {
    const { deps, client, runReviewPipeline, entries } = makeDeps();

    await reviewWithDelivery(target, deps);

    expect(client.getRepositoryArchive).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      ref: pullRequest.baseSha,
    });
    expect(indexPassedTo(runReviewPipeline)?.sha).toBe(pullRequest.baseSha);
    expect(entry(entries, "index.built")).toMatchObject({
      sha: pullRequest.baseSha,
      files: baseFiles.size,
      truncated: false,
    });
  });

  it("pairs the changed source file with its test", async () => {
    const { deps, runReviewPipeline } = makeDeps();

    await reviewWithDelivery(target, deps);

    expect(
      indexPassedTo(runReviewPipeline)?.files.get("src/sessions.ts")?.coveredBy,
    ).toBe("src/sessions.test.ts");
  });

  it("skips the archive entirely when the index is off", async () => {
    const { deps, client, runReviewPipeline, entries } = makeDeps(
      reviewResult(),
      { index: false },
    );

    await reviewWithDelivery(target, deps);

    expect(client.getRepositoryArchive).not.toHaveBeenCalled();
    expect(indexPassedTo(runReviewPipeline)).toBeUndefined();
    expect(entry(entries, "index.skipped")).toBeDefined();
    expect(entry(entries, "index.built")).toBeUndefined();
  });

  it("completes the review when the archive fails", async () => {
    const { deps, client, runReviewPipeline, entries } = makeDeps();
    client.getRepositoryArchive.mockRejectedValue(new Error("archive too large"));

    await expect(reviewWithDelivery(target, deps)).resolves.toBeDefined();

    expect(runReviewPipeline).toHaveBeenCalledTimes(1);
    expect(indexPassedTo(runReviewPipeline)).toBeUndefined();
    expect(entry(entries, "index.failed")).toMatchObject({
      reason: "archive too large",
      level: "error",
    });
  });

  it("reviews without an index when the archive is too large to inflate", async () => {
    const { deps, client, runReviewPipeline, entries } = makeDeps();
    client.getRepositoryArchive.mockRejectedValue(
      new ArchiveTooLargeError("the repository archive inflates past the cap"),
    );

    await expect(reviewWithDelivery(target, deps)).resolves.toBeDefined();

    expect(indexPassedTo(runReviewPipeline)).toBeUndefined();
    expect(entry(entries, "index.failed")).toMatchObject({
      reason: "the repository archive inflates past the cap",
      fallback: "reviewing without the repository index",
    });
  });

  it("carries the archive's truncation through to the index", async () => {
    const { deps, client, runReviewPipeline, entries } = makeDeps();
    client.getRepositoryArchive.mockResolvedValue({
      sha: pullRequest.baseSha,
      files: new Map(baseFiles),
      truncated: true,
    });

    await reviewWithDelivery(target, deps);

    expect(indexPassedTo(runReviewPipeline)?.truncated).toBe(true);
    expect(entry(entries, "index.built")).toMatchObject({ truncated: true });
  });
});

describe("cancellation", () => {
  function entry(entries: ReturnType<typeof makeDeps>["entries"], event: string) {
    return entries.find((logged) => logged["event"] === event);
  }

  it("puts the caller's signal on the context the agents receive", async () => {
    const controller = new AbortController();
    const { deps, runReviewPipeline } = makeDeps();

    await reviewWithDelivery(target, { ...deps, signal: controller.signal });

    expect(runReviewPipeline.mock.calls[0]?.[0]?.context).toMatchObject({
      signal: controller.signal,
    });
  });

  it("never starts a review whose signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, client, runReviewPipeline, entries } = makeDeps();

    await expect(
      reviewWithDelivery(target, { ...deps, signal: controller.signal }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(client.getPullRequest).not.toHaveBeenCalled();
    expect(runReviewPipeline).not.toHaveBeenCalled();
    expect(entry(entries, "review.cancelled")).toMatchObject({
      stage: "before start",
    });
  });

  it("publishes nothing when the pipeline is cancelled mid-run", async () => {
    const controller = new AbortController();
    const { deps, client, runReviewPipeline, entries } = makeDeps();
    runReviewPipeline.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expect(
      reviewWithDelivery(target, { ...deps, signal: controller.signal }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(client.createReview).not.toHaveBeenCalled();
    expect(entry(entries, "review.cancelled")).toMatchObject({
      stage: "agents",
    });
  });

  it("publishes nothing when the cancellation lands after the agents finished", async () => {
    const controller = new AbortController();
    const { deps, client, runReviewPipeline } = makeDeps(
      reviewResult({ candidates: [finding] }),
    );
    runReviewPipeline.mockImplementationOnce(async () => {
      controller.abort();
      return reviewResult({ candidates: [finding] });
    });

    await expect(
      reviewWithDelivery(target, { ...deps, signal: controller.signal }),
    ).rejects.toThrow(ReviewCancelledError);

    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(client.createReview).not.toHaveBeenCalled();
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

describe("reviewWithDelivery: suppressions", () => {
  it("excludes a suppressed finding and reports how many it hid", async () => {
    const elsewhere = { ...finding, title: "Assignment instead of comparison in isAdmin" };
    const { deps, client, entries } = makeDeps(reviewResult({ candidates: [elsewhere] }), {
      memoryStore: readOnlyStore(suppressionFile("Assignment instead of comparison in hasAccess")),
      now: () => NOW,
    });

    const outcome = await reviewWithDelivery(target, deps);

    expect(outcome.findings).toEqual([]);
    expect(outcome.suppressed).toBe(1);
    expect(client.createReview).not.toHaveBeenCalled();
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "findings.suppressed", suppressedCount: 1 }),
    );
  });

  it("publishes a finding the suppression no longer matches", async () => {
    const { deps, client, entries } = makeDeps(reviewResult({ candidates: [finding] }), {
      memoryStore: readOnlyStore(suppressionFile("Unbounded query in the session list")),
      now: () => NOW,
    });

    const outcome = await reviewWithDelivery(target, deps);

    expect(outcome.findings).toEqual([finding]);
    expect(outcome.suppressed).toBe(0);
    expect(client.createReview).toHaveBeenCalledTimes(1);
    expect(entries.map((entry) => entry["event"])).not.toContain("findings.suppressed");
  });
});
