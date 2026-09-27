/** The record a finished run sends to the dashboard. */
import { randomBytes } from "node:crypto";
import { emptyTokenUsage } from "@pr-review/ai";
import type { ChangedFile } from "@pr-review/github";
import {
  buildRepositoryIndex,
  decodeRepositoryGraph,
  snapshotRepositoryIndex,
} from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import {
  MAX_RISK_DEPENDENTS,
  MAX_RISK_FACTORS,
  MAX_RISK_HUBS,
  reviewRecordSchema,
  type ReviewFinding,
} from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { assessBlastRadius, type BlastRadius } from "#src/blast-radius";
import type { FinishedReviewRun } from "#src/review-delivery";
import { buildReviewRecord } from "#src/review-record";
import type { ReviewOutcome } from "#src/review-run";
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

function record(result: ReviewOutcome) {
  const { logger, entries } = createCapturingLogger();
  return { record: buildReviewRecord(target, run(result), logger), entries };
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

describe("buildReviewRecord", () => {
  it("records the target, base sha and every changed file with its line counts", () => {
    const built = record(outcome()).record;

    expect(built).toMatchObject({
      owner: "octo-org",
      repo: "example-service",
      prNumber: 42,
      headSha: target.headSha,
      summary: "0 findings",
      durationMs: 8_400,
      inputTokens: 1_200,
      outputTokens: 340,
      baseSha,
    });
    expect(built.changedFiles).toEqual([
      { path: "src/sessions.ts", status: "modified", additions: 2, deletions: 1 },
      { path: "src/added.ts", status: "added", additions: 10, deletions: 0 },
      { path: "src/gone.ts", status: "removed", additions: 0, deletions: 8 },
      { path: "src/moved.ts", status: "renamed", additions: 1, deletions: 1 },
      // GitHub's copied has no status of its own.
      { path: "src/copied.ts", status: "modified", additions: 3, deletions: 0 },
    ]);
  });

  it("sends the snapshot gzipped, with the counts the dashboard lists", () => {
    const { graph } = record(outcome({ graph: snapshot })).record;

    expect(graph).toMatchObject({ fileCount: 2, edgeCount: 1 });
    expect(decodeRepositoryGraph(Buffer.from(graph!.gzip, "base64"))).toEqual(
      snapshot,
    );
  });

  it("drops a graph past the schema's cap, logs it, and keeps the review", () => {
    const [file] = snapshot.files;
    const files = Array.from({ length: 150_000 }, () => ({
      ...file!,
      path: `src/${randomBytes(48).toString("base64url")}.ts`,
    }));
    const built = record(outcome({ graph: { ...snapshot, files } }));

    expect(built.record).not.toHaveProperty("graph");
    expect(built.entries).toMatchObject([
      {
        level: "error",
        event: "review_record.section_dropped",
        repository: "octo-org/example-service",
        section: "graph",
        issues: ["graph.gzip"],
      },
    ]);
    expect(reviewRecordSchema.safeParse(built.record).success).toBe(true);
  });

  it("drops a graph whose base sha was dropped", () => {
    const built = record(outcome({ baseSha: "", graph: snapshot }));

    expect(built.record).not.toHaveProperty("baseSha");
    expect(built.record).not.toHaveProperty("graph");
    expect(built.entries.map((entry) => entry["section"])).toEqual([
      "baseSha",
      "graph",
    ]);
    expect(reviewRecordSchema.safeParse(built.record).success).toBe(true);
  });

  it("sends no graph when the index was off or failed", () => {
    expect(record(outcome()).record).not.toHaveProperty("graph");
  });

  it("sends the blast radius as paths and numbers the schema accepts", () => {
    const built = record(outcome({ blastRadius })).record;

    expect(built.risk).toEqual({
      score: blastRadius.risk.score,
      band: blastRadius.risk.band,
      partial: false,
      factors: blastRadius.risk.factors,
      hubs: [{ path: "src/sessions.ts", dependents: 1 }],
      counts: blastRadius.impact.counts,
      packages: 0,
      dependents: ["src/login.ts"],
    });
    expect(reviewRecordSchema.safeParse(built).success).toBe(true);
  });

  it("caps factors, hubs and dependents at the schema's limits", () => {
    const wide: BlastRadius = {
      risk: {
        ...blastRadius.risk,
        factors: Array.from({ length: 25 }, (_, at) => ({
          label: `factor ${at}`,
          points: 1,
        })),
      },
      impact: {
        ...blastRadius.impact,
        hubs: Array.from({ length: 25 }, (_, at) => ({
          path: `src/hub-${at}.ts`,
          dependents: 25 - at,
        })),
        transitive: Array.from(
          { length: 500 },
          (_, at) => `src/dependent-${String(at).padStart(3, "0")}.ts`,
        ),
      },
    };

    const { risk } = record(outcome({ blastRadius: wide })).record;

    expect(risk?.factors).toEqual(wide.risk.factors.slice(0, MAX_RISK_FACTORS));
    expect(risk?.hubs).toEqual(wide.impact.hubs.slice(0, MAX_RISK_HUBS));
    expect(risk?.dependents).toEqual(
      wide.impact.transitive.slice(0, MAX_RISK_DEPENDENTS),
    );
  });

  it("drops only a risk the schema would reject, and logs its paths", () => {
    const bad: BlastRadius = {
      risk: { ...blastRadius.risk, score: 150 },
      impact: blastRadius.impact,
    };
    const built = record(outcome({ blastRadius: bad, graph: snapshot }));

    expect(built.record).not.toHaveProperty("risk");
    expect(built.record.graph).toBeDefined();
    expect(built.entries).toMatchObject([
      { section: "risk", issues: ["risk.score"] },
    ]);
  });

  it("sends no risk when the review had no blast radius", () => {
    expect(record(outcome()).record).not.toHaveProperty("risk");
  });

  it("keeps whether a finding had a patch, never the patch source", () => {
    const built = record(
      outcome({
        candidates: [patched, unpatched],
        findings: [patched, unpatched],
        patches: { proposed: 1, verified: 1 },
      }),
    ).record;

    expect(built.summary).toBe("2 findings");
    expect(built.findings.map((finding) => finding.hasPatch)).toEqual([
      true,
      false,
    ]);
    const body = JSON.stringify(built);
    expect(body).not.toContain(JSON.stringify(expected).slice(1, -1));
    expect(body).not.toContain(JSON.stringify(replacement).slice(1, -1));
    expect(body).not.toContain("isAdmin =");
  });

  it("sends none of the source the risk was scored from", () => {
    const body = JSON.stringify(record(outcome({ blastRadius })).record);

    expect(body).not.toContain("export const sessions");
    expect(body).not.toContain("import { sessions }");
  });
});

// Seeded, so a failure reproduces.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function arbitraryOutcome(next: () => number): ReviewOutcome {
  const int = (max: number) => Math.floor(next() * (max + 1));
  const text = (max: number) => "x".repeat(int(max));
  const list = <T>(max: number, item: (at: number) => T) =>
    Array.from({ length: int(max) }, (_, at) => item(at));
  const path = () => (next() < 0.05 ? text(5_000) : `src/${text(20)}.ts`);
  const number = () => (next() < 0.1 ? -1 : next() < 0.1 ? 1.5 : int(1_000));
  const counts = {
    direct: number(),
    transitive: number(),
    entryPoints: number(),
    untested: number(),
    inCycle: number(),
    brokenImporters: number(),
  };
  const radius: BlastRadius = {
    risk: {
      score: next() < 0.8 ? int(100) : number(),
      band: (["low", "medium", "high"] as const)[int(2)]!,
      partial: next() < 0.5,
      factors: list(25, () => ({
        label: next() < 0.9 ? `factor ${text(20)}` : text(300),
        points: next() < 0.9 ? int(100) : number(),
      })),
    },
    impact: {
      ...blastRadius.impact,
      transitive: list(500, path),
      packages: list(10, path),
      hubs: list(25, () => ({ path: path(), dependents: number() })),
      counts,
    },
  };
  return outcome({
    baseSha: next() < 0.9 ? baseSha : text(100),
    changedFiles: list(30, () => ({
      filename: next() < 0.95 ? path() : "",
      status: (["added", "modified", "copied", "unchanged"] as const)[int(3)]!,
      additions: number(),
      deletions: number(),
    })),
    ...(next() < 0.5 ? { graph: snapshot } : {}),
    ...(next() < 0.8 ? { blastRadius: radius } : {}),
    findings: list(5, (at) => (at % 2 === 0 ? patched : unpatched)),
  });
}

describe("buildReviewRecord, over arbitrary outcomes", () => {
  it("always builds a record the schema accepts", () => {
    const next = random(3);
    for (let trial = 0; trial < 300; trial += 1) {
      const built = record(arbitraryOutcome(next)).record;
      const parsed = reviewRecordSchema.safeParse(built);
      expect(parsed.error?.issues ?? [], `trial ${trial}`).toEqual([]);
    }
  });
});
