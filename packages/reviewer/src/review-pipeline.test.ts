import {
  ReviewCancelledError,
  type ReviewAgent,
  type ReviewContext,
} from "@pr-review/ai";
import type { ChangedFile } from "@pr-review/github";
import type { ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it, vi } from "vitest";

import { runReviewPipeline } from "#src/review-pipeline";

const changedFiles: ChangedFile[] = [
  {
    filename: "src/sessions.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -41,1 +41,2 @@\n context line 41\n+added line 42",
  },
];

const context: ReviewContext = {
  owner: "octo-org",
  repo: "example-service",
  pullRequest: {
    number: 42,
    title: "Add rate limiting",
    body: null,
    author: "octocat",
    baseRef: "main",
    baseSha: "0000000000000000000000000000000000000000",
    headRef: "feature/rate-limit",
    headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
  },
  changedFiles,
  diff: "",
};

function agent(run: ReviewAgent["run"]): ReviewAgent {
  return { name: "general", run };
}

/** A schema-valid candidate finding, overridable per test. */
function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: "src/sessions.ts",
    line: 42,
    category: "general",
    severity: "high",
    title: "Assignment instead of comparison in admin check",
    explanation:
      "The if condition assigns true to user.isAdmin instead of comparing, so every user passes the check.",
    confidence: 0.9,
    ...overrides,
  };
}

describe("runReviewPipeline", () => {
  it("runs the agent against the context and validates its candidates", async () => {
    const finding = makeFinding();
    const run = vi.fn(async () => [finding]);

    const result = await runReviewPipeline(agent(run), context);

    expect(run).toHaveBeenCalledWith(context);
    expect(result.candidates).toEqual([finding]);
    expect(result.findings).toEqual([finding]);
  });

  it("returns no findings when the agent proposes none", async () => {
    const result = await runReviewPipeline(agent(async () => []), context);

    expect(result).toEqual({ candidates: [], findings: [] });
  });

  it("fails the review when the agent fails", async () => {
    await expect(
      runReviewPipeline(
        agent(async () => {
          throw new Error("model unavailable");
        }),
        context,
      ),
    ).rejects.toThrow("model unavailable");
  });
});

describe("runReviewPipeline: deterministic validation", () => {
  it("drops a fabricated file or line", async () => {
    const fabricated = makeFinding({ file: "src/not-part-of-this-pr.ts", line: 7 });

    const result = await runReviewPipeline(agent(async () => [fabricated]), context);

    expect(result.candidates).toEqual([fabricated]);
    expect(result.findings).toEqual([]);
  });

  it("validates against the context's changed-file list", async () => {
    const otherFile: ChangedFile = {
      filename: "src/rate-limit.ts",
      status: "added",
      additions: 2,
      deletions: 0,
      patch: "@@ -0,0 +1,2 @@\n+added line 1\n+added line 2",
    };
    const otherContext: ReviewContext = { ...context, changedFiles: [otherFile] };
    const inThisPr = makeFinding({ file: "src/rate-limit.ts", line: 2 });
    const notInThisPr = makeFinding({ file: "src/sessions.ts", line: 42 });

    const result = await runReviewPipeline(
      agent(async () => [inThisPr, notInThisPr]),
      otherContext,
    );

    expect(result.candidates).toEqual([inThisPr, notInThisPr]);
    expect(result.findings).toEqual([inThisPr]);
  });
});

describe("runReviewPipeline: cancellation", () => {
  it("starts no agent when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async () => [makeFinding()]);

    await expect(
      runReviewPipeline(agent(run), { ...context, signal: controller.signal }),
    ).rejects.toThrow(ReviewCancelledError);
    expect(run).not.toHaveBeenCalled();
  });

  it("throws a cancellation when the agent is aborted mid-run", async () => {
    const controller = new AbortController();

    await expect(
      runReviewPipeline(
        agent(async () => {
          controller.abort();
          throw new DOMException("The operation was aborted", "AbortError");
        }),
        { ...context, signal: controller.signal },
      ),
    ).rejects.toThrow(ReviewCancelledError);
  });

  it("completes normally while the signal stays live", async () => {
    const controller = new AbortController();
    const finding = makeFinding();

    const result = await runReviewPipeline(agent(async () => [finding]), {
      ...context,
      signal: controller.signal,
    });

    expect(result.findings).toEqual([finding]);
  });
});
