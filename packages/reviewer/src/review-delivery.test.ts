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
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

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

const run: FinishedReviewRun = {
  outcome: {
    candidates: [patched, unpatched],
    findings: [patched, unpatched],
    patches: { proposed: 1, verified: 1 },
    suppressed: 0,
  },
  usage: {
    inputTokens: 1_200,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 340,
  },
  durationMs: 8_400,
};

describe("dashboardReview", () => {
  it("keeps whether a finding had a patch, not the patch", () => {
    const findings = dashboardReview(run).findings;
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
    ).publishRun?.(target, run);

    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body).not.toContain(JSON.stringify(expected).slice(1, -1));
    expect(body).not.toContain(JSON.stringify(replacement).slice(1, -1));
    expect(body).not.toContain("isAdmin =");
    expect(reviewRecordSchema.safeParse(JSON.parse(body)).success).toBe(true);
    expect(recorded.runs[0]?.outcome.findings[0]?.patch).toEqual(patched.patch);
  });
});
