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
  summary: "One finding worth a look.",
  durationMs: 45_000,
  inputTokens: 12_000,
  cacheCreationInputTokens: 4_000,
  cacheReadInputTokens: 20_000,
  outputTokens: 800,
  findings: [
    {
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

  it("accepts a record with no findings", () => {
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      summary: "",
      findings: [],
    });
    expect(result.success).toBe(true);
  });

  it("defaults missing token counters to zero", () => {
    const {
      inputTokens: _in,
      cacheCreationInputTokens: _cw,
      cacheReadInputTokens: _cr,
      outputTokens: _out,
      ...withoutTokens
    } = validRecord;
    const result = reviewRecordSchema.safeParse(withoutTokens);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inputTokens).toBe(0);
      expect(result.data.outputTokens).toBe(0);
    }
  });

  it("strips fields an older action still sends", () => {
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      agents: ["security"],
      agentRuns: [{ agent: "security", durationMs: 1 }],
      findings: [{ ...validRecord.findings[0], agent: "security" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validRecord);
    }
  });

  it("accepts whether a finding had a patch", () => {
    const [finding] = validRecord.findings;
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      findings: [{ ...finding, hasPatch: true }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.findings[0]?.hasPatch).toBe(true);
    }
  });

  it("drops the patch source an older reviewer still sends", () => {
    const [finding] = validRecord.findings;
    const patch = { startLine: 1, endLine: 1, expected: "a", replacement: "b" };
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      findings: [{ ...finding, patch }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.findings[0]).not.toHaveProperty("patch");
    }
  });

  it("accepts a finding's hasPatch flag", () => {
    const [finding] = validRecord.findings;
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      findings: [{ ...finding, hasPatch: true }],
    });
    expect(result.success && result.data.findings[0]?.hasPatch).toBe(true);
  });

  it("drops patch source text an older sender still includes", () => {
    const [finding] = validRecord.findings;
    const result = reviewRecordSchema.safeParse({
      ...validRecord,
      findings: [
        {
          ...finding,
          patch: { startLine: 1, endLine: 1, expected: "a", replacement: "b" },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data?.findings[0]).not.toHaveProperty("patch");
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
    for (const bad of [
      { inputTokens: -1 },
      { cacheReadInputTokens: 0.5 },
      { durationMs: -5 },
    ]) {
      expect(
        reviewRecordSchema.safeParse({ ...validRecord, ...bad }).success,
      ).toBe(false);
    }
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
