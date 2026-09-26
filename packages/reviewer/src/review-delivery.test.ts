/** What a finished run contributes to the dashboard record. */
import { randomBytes } from "node:crypto";
import type { ChangedFile } from "@pr-review/github";
import {
  buildRepositoryIndex,
  decodeRepositoryGraph,
  MAX_IMPACT_FILES,
  snapshotRepositoryIndex,
} from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import {
  emptyTokenUsage,
  MAX_RISK_DEPENDENTS,
  reviewRecordSchema,
  type ReviewFinding,
} from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { assessBlastRadius, type BlastRadius } from "#src/blast-radius";
import type { DashboardReview } from "#src/publish-dashboard";
import {
  dashboardDelivery,
  dashboardReview,
  recordingDelivery,
  type FinishedReviewRun,
} from "#src/review-delivery";
import type { ReviewOutcome } from "#src/review-pull-request";
import type { ReviewTarget } from "#src/review-target";

const baseSha = "0000000000000000000000000000000000000000";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

const index = buildRepositoryIndex({
  sha: baseSha,
  files: new Map([
    ["src/sessions.ts", "export const sessions = [];\n"],
    ["src/login.ts", "import { sessions } from './sessions';\n"],
  ]),
});
const snapshot = snapshotRepositoryIndex(index);

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
    findings: [],
    patches: { proposed: 0, verified: 0 },
    suppressed: 0,
    baseSha,
    changedFiles,
    ...overrides,
  };
}

function run(result: ReviewOutcome): FinishedReviewRun {
  return {
    outcome: result,
    usage: { ...emptyTokenUsage(), inputTokens: 1_200, outputTokens: 340 },
    durationMs: 8_400,
  };
}

const blastRadius = assessBlastRadius({
  index,
  changedFiles,
  target,
  logger: createCapturingLogger().logger,
})!;

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

  it("drops a graph past the schema's cap but keeps the review", () => {
    const [file] = snapshot.files;
    const files = Array.from({ length: 150_000 }, () => ({
      ...file!,
      path: `src/${randomBytes(48).toString("base64url")}.ts`,
    }));
    const record = dashboardReview(
      run(outcome({ graph: { ...snapshot, files } })),
    );

    expect(record.graph).toBeUndefined();
    expect(record.summary).toBeDefined();
  });

  it("sends no graph when the index was off or failed", () => {
    expect(dashboardReview(run(outcome())).graph).toBeUndefined();
  });

  it("sends the blast radius as paths and numbers the schema accepts", () => {
    const record = dashboardReview(run(outcome({ blastRadius })));

    expect(record.risk).toEqual({
      score: blastRadius.risk.score,
      band: blastRadius.risk.band,
      partial: false,
      factors: blastRadius.risk.factors,
      hubs: [{ path: "src/sessions.ts", dependents: 1 }],
      counts: blastRadius.impact.counts,
      packages: 0,
      dependents: ["src/login.ts"],
    });
    const { success } = reviewRecordSchema.safeParse({
      owner: target.owner,
      repo: target.repo,
      prNumber: target.pullRequestNumber,
      headSha: target.headSha,
      ...record,
    });
    expect(success).toBe(true);
  });

  it("caps dependents where the index caps its impact lists", () => {
    expect(MAX_RISK_DEPENDENTS).toBe(MAX_IMPACT_FILES);
  });

  it("caps the dependents it sends, whatever the impact carries", () => {
    const transitive = Array.from(
      { length: MAX_RISK_DEPENDENTS + 50 },
      (_, at) => `src/dependent-${String(at).padStart(3, "0")}.ts`,
    );
    const wide: BlastRadius = {
      risk: blastRadius.risk,
      impact: { ...blastRadius.impact, transitive },
    };

    const dependents = dashboardReview(run(outcome({ blastRadius: wide }))).risk
      ?.dependents;

    expect(dependents).toEqual(transitive.slice(0, MAX_RISK_DEPENDENTS));
  });

  it("sends no risk when the review had no blast radius", () => {
    expect(dashboardReview(run(outcome()))).not.toHaveProperty("risk");
  });

  it("keeps whether a finding had a patch, not the patch", () => {
    const findings = dashboardReview(patchedRun).findings;
    expect(findings.map((finding) => finding.hasPatch)).toEqual([true, false]);
    expect(findings.every((finding) => !("patch" in finding))).toBe(true);
  });
});

describe("dashboardDelivery", () => {
  it("sends no patch source text in the dashboard record", async () => {
    const bodies: string[] = [];
    const { delivery, recorded } = recordingDelivery();

    await dashboardDelivery(delivery, async (published, review) => {
      bodies.push(
        JSON.stringify({
          owner: published.owner,
          repo: published.repo,
          prNumber: published.pullRequestNumber,
          headSha: published.headSha,
          ...review,
        }),
      );
    }).publishRun?.(target, patchedRun);

    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body).not.toContain(JSON.stringify(expected).slice(1, -1));
    expect(body).not.toContain(JSON.stringify(replacement).slice(1, -1));
    expect(body).not.toContain("isAdmin =");
    expect(reviewRecordSchema.safeParse(JSON.parse(body)).success).toBe(true);
    expect(recorded.runs[0]?.outcome.findings[0]?.patch).toEqual(patched.patch);
  });

  it("sends the risk score, and none of the source it was scored from", async () => {
    const sent: DashboardReview[] = [];
    await dashboardDelivery(recordingDelivery().delivery, async (_target, review) => {
      sent.push(review);
    }).publishRun?.(target, run(outcome({ blastRadius })));

    const body = JSON.stringify({
      owner: target.owner,
      repo: target.repo,
      prNumber: target.pullRequestNumber,
      headSha: target.headSha,
      ...sent[0],
    });
    const parsed = reviewRecordSchema.safeParse(JSON.parse(body));
    expect(parsed.success && parsed.data.risk?.dependents).toEqual([
      "src/login.ts",
    ]);
    expect(body).not.toContain("export const sessions");
    expect(body).not.toContain("import { sessions }");
  });

});
