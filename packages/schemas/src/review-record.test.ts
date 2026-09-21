import { describe, expect, it } from "vitest";

import {
  MAX_REPOSITORY_GRAPH_BASE64,
  reviewRecordSchema,
  type ReviewRecord,
} from "#src/index";

const validRecord: ReviewRecord = {
  owner: "acme",
  repo: "widgets",
  prNumber: 42,
  headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567",
  agents: ["security", "performance"],
  summary: "Two findings worth a look.",
  durationMs: 45_000,
  agentRuns: [
    {
      agent: "security",
      durationMs: 41_000,
      findingCount: 1,
      inputTokens: 12_000,
      cacheCreationInputTokens: 4_000,
      cacheReadInputTokens: 20_000,
      outputTokens: 800,
    },
    {
      agent: "performance",
      durationMs: 30_000,
      findingCount: 0,
      inputTokens: 9_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 500,
    },
  ],
  findings: [
    {
      agent: "security",
      file: "src/auth/session.ts",
      line: 84,
      category: "security",
      severity: "high",
      title: "Missing tenant validation",
      explanation: "The session query is not filtered by tenant.",
      suggestedFix: "Filter by the authenticated tenant id.",
      confidence: 0.9,
    },
  ],
};

describe("reviewRecordSchema", () => {
  it("accepts a fully populated record", () => {
    const result = reviewRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validRecord);
    }
  });

  it("accepts a record with no agents, runs or findings", () => {
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      agents: [],
      agentRuns: [],
      summary: "",
      findings: [],
    });
    expect(result.success).toBe(true);
  });

  it("treats a finding's agent as optional", () => {
    const [finding] = validRecord.findings;
    const { agent: _agent, ...withoutAgent } = finding!;
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      findings: [withoutAgent],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.findings[0]?.agent).toBeUndefined();
    }
  });

  it("rejects a finding that breaks the finding contract", () => {
    const [finding] = validRecord.findings;
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      findings: [{ ...finding, severity: "critical" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive pr number", () => {
    for (const prNumber of [0, -1, 1.5]) {
      expect(
        reviewRecordSchema.safeParse({ ...validRecord, prNumber }).success,
      ).toBe(false);
    }
  });

  it("rejects empty owner, repo, or headSha", () => {
    for (const field of ["owner", "repo", "headSha"] as const) {
      expect(
        reviewRecordSchema.safeParse({ ...validRecord, [field]: "" }).success,
      ).toBe(false);
    }
  });

  it("rejects negative or fractional token counts and durations", () => {
    const [run] = validRecord.agentRuns;
    for (const bad of [
      { ...run, inputTokens: -1 },
      { ...run, cacheReadInputTokens: 0.5 },
      { ...run, durationMs: -5 },
    ]) {
      expect(
        reviewRecordSchema.safeParse({ ...validRecord, agentRuns: [bad] })
          .success,
      ).toBe(false);
    }
    expect(
      reviewRecordSchema.safeParse({ ...validRecord, durationMs: -5 }).success,
    ).toBe(false);
  });

  it("rejects the same agent twice", () => {
    const [run] = validRecord.agentRuns;
    expect(
      reviewRecordSchema.safeParse({ ...validRecord, agentRuns: [run, run] })
        .success,
    ).toBe(false);
  });

  it("rejects a missing agentRuns array", () => {
    const { agentRuns: _runs, ...withoutRuns } = validRecord;
    expect(reviewRecordSchema.safeParse(withoutRuns).success).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(reviewRecordSchema.safeParse("not a record").success).toBe(false);
    expect(reviewRecordSchema.safeParse(null).success).toBe(false);
  });
});

const baseSha = "9a8b7c6d5e4f30211203f4e5d6c7b8a900000000";

describe("reviewRecordSchema, with a repository graph", () => {
  const withGraph = {
    ...validRecord,
    baseSha,
    changedFiles: [
      {
        path: "src/auth/session.ts",
        status: "modified",
        additions: 12,
        deletions: 3,
      },
      { path: "src/auth/new.ts", status: "added", additions: 40, deletions: 0 },
    ],
    graph: { gzip: "H4sIAAAAAAAAA", fileCount: 120, edgeCount: 310 },
  };

  it("accepts a record carrying changed files and a snapshot", () => {
    const result = reviewRecordSchema.safeParse(withGraph);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(withGraph);
    }
  });

  it("accepts changed files with no snapshot, and a record with neither", () => {
    const { graph: _graph, ...noGraph } = withGraph;
    expect(reviewRecordSchema.safeParse(noGraph).success).toBe(true);
    expect(reviewRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it("rejects a snapshot without the base sha it was built at", () => {
    const { baseSha: _baseSha, ...unanchored } = withGraph;
    expect(reviewRecordSchema.safeParse(unanchored).success).toBe(false);
  });

  it("rejects a changed file with an unknown status or negative counts", () => {
    for (const file of [
      { path: "a.ts", status: "exploded", additions: 1, deletions: 0 },
      { path: "a.ts", status: "added", additions: -1, deletions: 0 },
      { path: "", status: "added", additions: 1, deletions: 0 },
    ]) {
      expect(
        reviewRecordSchema.safeParse({ ...withGraph, changedFiles: [file] })
          .success,
      ).toBe(false);
    }
  });

  it("rejects an empty or oversized snapshot body", () => {
    for (const gzip of ["", "x".repeat(MAX_REPOSITORY_GRAPH_BASE64 + 1)]) {
      expect(
        reviewRecordSchema.safeParse({
          ...withGraph,
          graph: { ...withGraph.graph, gzip },
        }).success,
      ).toBe(false);
    }
  });
});
