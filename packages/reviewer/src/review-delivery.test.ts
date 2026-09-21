import { emptyTokenUsage } from "@pr-review/ai";
import { createCapturingLogger } from "@pr-review/logging";
import { reviewRecordSchema, type ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { createDashboardPublisher } from "#src/publish-dashboard";
import {
  dashboardDelivery,
  recordingDelivery,
  type FinishedReviewRun,
} from "#src/review-delivery";
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

const patched: ReviewFinding = {
  file: "src/sessions.ts",
  line: 12,
  category: "correctness",
  severity: "high",
  title: "Assignment instead of comparison in admin check",
  explanation: "The if condition assigns instead of comparing.",
  suggestedFix: "Compare with ===.",
  patch: {
    startLine: 12,
    endLine: 12,
    expected: "if (user.isAdmin = SOURCE_SENTINEL_EXPECTED_7f3a) {",
    replacement: "if (user.isAdmin === SOURCE_SENTINEL_REPLACEMENT_9c1d) {",
  },
  confidence: 0.9,
};

const unpatched: ReviewFinding = {
  file: "src/limits.ts",
  category: "correctness",
  severity: "low",
  title: "Limit is never read",
  explanation: "The constant is declared but unused.",
  confidence: 0.6,
};

function finishedRun(findings: ReviewFinding[]): FinishedReviewRun {
  return {
    outcome: {
      candidates: findings,
      agentFailures: [],
      synthesis: {
        outcome: "skipped",
        candidates: findings,
        reason: "standalone agent",
      },
      findings,
      patches: { proposed: 1, verified: 1 },
      suppressed: 0,
    },
    agents: [],
    usage: [
      { agent: "correctness", durationMs: 1_000, usage: emptyTokenUsage() },
    ],
    durationMs: 1_200,
  };
}

async function publishThroughDashboard(run: FinishedReviewRun) {
  const bodies: string[] = [];
  const publish = createDashboardPublisher({
    baseUrl: "https://dash.example.app",
    token: "ingest-secret",
    fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      return Response.json({ reviewId: 1 });
    },
    logger: createCapturingLogger().logger,
  });
  const { delivery, recorded } = recordingDelivery();
  await dashboardDelivery(delivery, publish).publishRun?.(target, run);
  return { body: bodies[0] ?? "", recorded };
}

describe("dashboardDelivery", () => {
  it("sends no patch source text to the ingest endpoint", async () => {
    const { body } = await publishThroughDashboard(
      finishedRun([patched, unpatched]),
    );

    expect(body).toContain("src/sessions.ts");
    expect(body).not.toContain("SOURCE_SENTINEL_EXPECTED_7f3a");
    expect(body).not.toContain("SOURCE_SENTINEL_REPLACEMENT_9c1d");
    expect(body).not.toContain('"patch"');
  });

  it("says which findings carried a patch, in a body ingest accepts", async () => {
    const { body } = await publishThroughDashboard(
      finishedRun([patched, unpatched]),
    );

    const parsed = reviewRecordSchema.parse(JSON.parse(body));
    expect(parsed.findings.map((finding) => finding.hasPatch)).toEqual([
      true,
      false,
    ]);
    expect(parsed.findings[0]).toMatchObject({
      file: "src/sessions.ts",
      line: 12,
      suggestedFix: "Compare with ===.",
      agent: "correctness",
    });
  });

  it("leaves the run's own findings, patches included, untouched", async () => {
    const { recorded } = await publishThroughDashboard(finishedRun([patched]));

    expect(recorded.runs[0]?.outcome.findings[0]?.patch).toEqual(patched.patch);
  });
});
