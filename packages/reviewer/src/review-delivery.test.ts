/** What a finished run contributes to the dashboard record. */
import { emptyTokenUsage, type AgentUsageReport } from "@pr-review/ai";
import type { ChangedFile } from "@pr-review/github";
import {
  buildRepositoryIndex,
  decodeRepositoryGraph,
  snapshotRepositoryIndex,
} from "@pr-review/index";
import { describe, expect, it } from "vitest";

import { skippedSynthesis } from "#src/review-pipeline";
import { dashboardReview } from "#src/review-delivery";
import type { FinishedReviewRun } from "#src/review-delivery";
import type { ReviewOutcome } from "#src/review-pull-request";

const baseSha = "0000000000000000000000000000000000000000";

const snapshot = snapshotRepositoryIndex(
  buildRepositoryIndex({
    sha: baseSha,
    files: new Map([
      ["src/sessions.ts", "export const sessions = [];\n"],
      ["src/login.ts", "import { sessions } from './sessions';\n"],
    ]),
  }),
);

const changedFiles: ChangedFile[] = [
  { filename: "src/sessions.ts", status: "modified", additions: 2, deletions: 1 },
  { filename: "src/added.ts", status: "added", additions: 10, deletions: 0 },
  { filename: "src/gone.ts", status: "removed", additions: 0, deletions: 8 },
  { filename: "src/moved.ts", status: "renamed", additions: 1, deletions: 1 },
  { filename: "src/copied.ts", status: "copied", additions: 3, deletions: 0 },
];

function outcome(overrides: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    candidates: [],
    agentFailures: [],
    synthesis: skippedSynthesis("no candidate findings", []),
    findings: [],
    patches: { proposed: 0, verified: 0 },
    suppressed: 0,
    baseSha,
    changedFiles,
    ...overrides,
  };
}

function run(result: ReviewOutcome): FinishedReviewRun {
  const usage: AgentUsageReport[] = [
    { agent: "correctness", durationMs: 1_000, usage: emptyTokenUsage() },
  ];
  return { outcome: result, agents: [], usage, durationMs: 2_000 };
}

describe("dashboardReview", () => {
  it("records the base sha and every changed file with its line counts", () => {
    const record = dashboardReview(run(outcome()));

    expect(record.baseSha).toBe(baseSha);
    expect(record.changedFiles).toEqual([
      { path: "src/sessions.ts", status: "modified", additions: 2, deletions: 1 },
      { path: "src/added.ts", status: "added", additions: 10, deletions: 0 },
      { path: "src/gone.ts", status: "removed", additions: 0, deletions: 8 },
      { path: "src/moved.ts", status: "renamed", additions: 1, deletions: 1 },
      // GitHub's copied has no status of its own.
      { path: "src/copied.ts", status: "modified", additions: 3, deletions: 0 },
    ]);
  });

  it("sends the snapshot gzipped, with the counts the dashboard lists", () => {
    const record = dashboardReview(run(outcome({ graph: snapshot })));

    expect(record.graph).toMatchObject({ fileCount: 2, edgeCount: 1 });
    expect(
      decodeRepositoryGraph(Buffer.from(record.graph!.gzip, "base64")),
    ).toEqual(snapshot);
  });

  it("sends no graph when the index was off or failed", () => {
    expect(dashboardReview(run(outcome())).graph).toBeUndefined();
  });
});
