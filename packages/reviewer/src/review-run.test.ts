import {
  GENERAL_AGENT,
  type AgentDefinition,
  type ReviewAgent,
  type ReviewContext,
} from "@pr-review/ai";
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
import { createCapturingLogger } from "@pr-review/logging";
import { reviewMemorySchema, type ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it, vi } from "vitest";

import type { MemoryStore } from "#src/memory";
import type { DashboardReview } from "#src/publish-dashboard";
import {
  dashboardDelivery,
  githubDelivery,
  recordingDelivery,
  type ReviewDelivery,
} from "#src/review-delivery";
import {
  runReview,
  type ReviewEngine,
  type ReviewMemory,
} from "#src/review-run";
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

const baseSha = "0000000000000000000000000000000000000000";

const pullRequest: PullRequestDetails = {
  number: 42,
  title: "Add rate limiting to the sessions endpoint",
  body: "Adds a token bucket to the sessions endpoint.",
  author: "octocat",
  baseRef: "main",
  baseSha,
  headRef: "feature/rate-limit",
  headSha: target.headSha,
};

const changedFiles: ChangedFile[] = [
  {
    filename: "src/sessions.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: "@@ -1 +1,2 @@\n const sessions = [];\n+const limit = 0;\n",
  },
];

const finding: ReviewFinding = {
  file: "src/sessions.ts",
  line: 2,
  category: "general",
  severity: "high",
  title: "Assignment instead of comparison in admin check",
  explanation:
    "The if condition assigns true to user.isAdmin instead of comparing, so every user passes the check.",
  confidence: 0.9,
};

function makeClient() {
  return {
    getPullRequest: vi.fn(async (_ref: PullRequestRef) => pullRequest),
    listChangedFiles: vi.fn(async (_ref: PullRequestRef) => changedFiles),
    getDiff: vi.fn(
      async (_ref: PullRequestRef) =>
        "diff --git a/src/sessions.ts b/src/sessions.ts\n",
    ),
    getFileContents: vi.fn(async () => ""),
    searchCode: vi.fn(async () => ({
      matches: [],
      totalCount: 0,
      incompleteResults: false,
    })),
    getRepositoryArchive: vi.fn(async (request: RepositoryArchiveRequest) => ({
      sha: request.ref,
      files: new Map([["src/sessions.ts", "export const sessions = [];\n"]]),
      truncated: false,
    })),
    listCommitShas: vi.fn(async () => []),
    listCommitFiles: vi.fn(async () => []),
    listReviewComments: vi.fn(async (): Promise<ExistingReviewComment[]> => []),
    listPullRequestCommitShas: vi.fn(async (): Promise<string[]> => [
      target.headSha,
    ]),
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

/** An engine whose agent is scripted, so no model is built. */
function scriptedEngine(candidates: readonly unknown[] = []): {
  engine: ReviewEngine;
  ran: AgentDefinition[];
} {
  const ran: AgentDefinition[] = [];
  return {
    ran,
    engine: {
      createAgent: ({ agent }): ReviewAgent => {
        ran.push(agent);
        return {
          name: agent.category,
          run: async (_context: ReviewContext) => candidates,
        };
      },
    },
  };
}

const NOW = new Date("2026-09-13T12:00:00.000Z");

/** A memory file holding one shape the repository keeps acting on. */
function memoryFile(): string {
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
        },
      ],
    }),
  );
}

function readOnlyStore(content: string): MemoryStore {
  return { read: async () => content, write: async () => {} };
}

const { logger } = createCapturingLogger();

describe("runReview: the agent", () => {
  it("runs the general agent without reading the repository", async () => {
    const client = makeClient();
    const { engine, ran } = scriptedEngine();

    await runReview({
      client,
      target,
      delivery: recordingDelivery().delivery,
      engine,
      logger,
    });

    expect(client.getFileContents).not.toHaveBeenCalled();
    expect(ran).toEqual([GENERAL_AGENT]);
  });
});

describe("runReview: delivery", () => {
  it("writes nothing through a publish-capable client when the delivery records", async () => {
    const client = makeClient();
    const { engine } = scriptedEngine([finding]);
    const { delivery, recorded } = recordingDelivery();

    const run = await runReview({
      client,
      target,
      delivery,
      engine,
      logger,
    });

    expect(writesOf(client)).toBe(0);
    expect(recorded.checkRun?.conclusion).toBe("neutral");
    expect(recorded.review?.comments).toHaveLength(1);
    expect(run.outcome.findings).toEqual([finding]);
  });

  it("publishes the check run and the comments through the GitHub adapter", async () => {
    const client = makeClient();
    const { engine } = scriptedEngine([finding]);

    await runReview({
      client,
      target,
      delivery: githubDelivery({ client, logger }),
      engine,
      logger,
    });

    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
    expect(client.createReview).toHaveBeenCalledTimes(1);
  });

  it("commits nothing when the GitHub adapter was not asked to commit fixes", async () => {
    const client = makeClient();
    const { engine } = scriptedEngine([finding]);

    await runReview({
      client,
      target,
      delivery: githubDelivery({ client, logger }),
      engine,
      logger,
    });

    expect(client.createCommitOnBranch).not.toHaveBeenCalled();
  });

  it("mirrors the finished run to the dashboard adapter", async () => {
    const published: DashboardReview[] = [];
    const { delivery, recorded } = recordingDelivery();
    const { engine } = scriptedEngine([finding]);

    const run = await runReview({
      client: makeClient(),
      target,
      delivery: dashboardDelivery(delivery, async (_target, review) => {
        published.push(review);
      }),
      engine,
      logger,
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.findings).toEqual([{ ...finding, hasPatch: false }]);
    expect(published[0]?.summary).toBe("1 finding");
    expect(recorded.runs[0]).toBe(run);
  });
});

describe("runReview: repository memory", () => {
  it("hands the agent the hints the store produced", async () => {
    const { engine, ran } = scriptedEngine([finding]);

    await runReview({
      client: makeClient(),
      target,
      delivery: recordingDelivery().delivery,
      engine,
      memory: { store: readOnlyStore(memoryFile()), now: () => NOW },
      logger,
    });

    expect(ran[0]?.repositoryHints).toEqual([
      'Findings like "assignment instead of comparison in".',
    ]);
  });

  it("runs the agent without hints when no store is given", async () => {
    const { engine, ran } = scriptedEngine([finding]);

    await runReview({
      client: makeClient(),
      target,
      delivery: recordingDelivery().delivery,
      engine,
      logger,
    });

    expect(ran[0]?.repositoryHints).toBeUndefined();
  });
});

describe("runReview: policy", () => {
  it("skips the repository index when the policy switches it off", async () => {
    const client = makeClient();
    const { engine } = scriptedEngine();

    await runReview({
      client,
      target,
      delivery: recordingDelivery().delivery,
      engine,
      policy: { index: false },
      logger,
    });

    expect(client.getRepositoryArchive).not.toHaveBeenCalled();
  });

  it("blames nothing when the policy switches reviewer suggestions off", async () => {
    const client = makeClient();
    const { engine } = scriptedEngine();

    await runReview({
      client,
      target,
      delivery: recordingDelivery().delivery,
      engine,
      policy: { suggestReviewers: false },
      logger,
    });

    expect(client.blame).not.toHaveBeenCalled();
  });

  it("suggests reviewers unless the policy says otherwise", async () => {
    const client = makeClient();
    const { engine } = scriptedEngine();

    await runReview({
      client,
      target,
      delivery: recordingDelivery().delivery,
      engine,
      logger,
    });

    expect(client.blame).toHaveBeenCalledWith(
      expect.objectContaining({ ref: baseSha, path: "src/sessions.ts" }),
    );
  });

  it("narrows the review to the commits since the last one", async () => {
    const client = makeClient();
    client.listPullRequestCommitShas.mockResolvedValue(["older", target.headSha]);
    client.listCheckRuns.mockImplementation(async ({ sha }) =>
      sha === "older" ? [{ name: "AI PR Review", status: "completed" }] : [],
    );
    client.compareCommits.mockResolvedValue({
      status: "ahead",
      files: changedFiles,
    });
    const { engine } = scriptedEngine();

    await runReview({
      client,
      target,
      delivery: recordingDelivery().delivery,
      engine,
      policy: { incremental: true },
      logger,
    });

    expect(client.compareCommits).toHaveBeenCalled();
  });
});

describe("delivery adapters", () => {
  it("gives the GitHub adapter a committer only when asked", () => {
    const client = makeClient();
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
    const { engine } = scriptedEngine();
    const spec = {
      client: makeClient(),
      target,
      engine,
      logger,
    };

    // @ts-expect-error a run has no delivery to fall back on.
    expect(() => runReview(spec)).toBeDefined();
  });

  it("refuses a clock without a memory store to age", () => {
    const memory = { now: () => NOW };

    // @ts-expect-error `store` is what makes a clock mean anything.
    const typed: ReviewMemory = memory;
    expect(typed.now?.()).toEqual(NOW);
  });
});
