/** What a finished run contributes to the dashboard record. */
import { emptyTokenUsage, type AgentUsageReport } from "@pr-review/ai";
import type { ChangedFile } from "@pr-review/github";
import {
  buildRepositoryIndex,
  decodeRepositoryGraph,
  snapshotRepositoryIndex,
} from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import { reviewRecordSchema, type ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { createDashboardPublisher } from "#src/publish-dashboard";
import {
  dashboardDelivery,
  dashboardReview,
  recordingDelivery,
  type FinishedReviewRun,
} from "#src/review-delivery";
import { skippedSynthesis } from "#src/review-pipeline";
import type { ReviewOutcome } from "#src/review-pull-request";
import type { ReviewTarget } from "#src/review-target";

const baseSha = "0000000000000000000000000000000000000000";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

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

const expected = "  if (user.isAdmin = true) {\n";
const replacement = "  if (user.isAdmin === true) {\n";

const patched: ReviewFinding = {
  file: "src/sessions.ts",
  line: 42,
  category: "security",
  severity: "high",
  title: "Assignment instead of comparison in admin check",
  explanation: "The if condition assigns instead of comparing.",
  suggestedFix: "Compare with ===.",
  patch: { startLine: 42, endLine: 42, expected, replacement },
  confidence: 0.95,
};

const unpatched: ReviewFinding = {
  file: "src/limits.ts",
  category: "security",
  severity: "low",
  title: "Unbounded retry",
  explanation: "The retry loop has no cap.",
  confidence: 0.6,
};

const patchedRun = run(
  outcome({
    candidates: [patched, unpatched],
    synthesis: skippedSynthesis("standalone agent", [patched, unpatched]),
    findings: [patched, unpatched],
    patches: { proposed: 1, verified: 1 },
  }),
);

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

  it("keeps whether a finding had a patch, not the patch", () => {
    const findings = dashboardReview(patchedRun).findings;
    expect(findings.map((finding) => finding.hasPatch)).toEqual([true, false]);
    expect(findings.every((finding) => !("patch" in finding))).toBe(true);
  });
});

describe("dashboardDelivery", () => {
  it("sends no patch source text in the ingest body", async () => {
    const bodies: string[] = [];
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return Response.json({ reviewId: 1 });
    };
    const { delivery, recorded } = recordingDelivery();

    await dashboardDelivery(
      delivery,
      createDashboardPublisher({
        baseUrl: "https://dash.example.app",
        token: "t",
        fetch,
        logger: createCapturingLogger().logger,
      }),
    ).publishRun?.(target, patchedRun);

    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body).not.toContain(JSON.stringify(expected).slice(1, -1));
    expect(body).not.toContain(JSON.stringify(replacement).slice(1, -1));
    expect(body).not.toContain("isAdmin =");
    expect(reviewRecordSchema.safeParse(JSON.parse(body)).success).toBe(true);
    expect(recorded.runs[0]?.outcome.findings[0]?.patch).toEqual(patched.patch);
  });
});
