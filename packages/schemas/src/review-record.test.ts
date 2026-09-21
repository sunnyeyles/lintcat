import { describe, expect, it } from "vitest";

import { reviewRecordSchema, type ReviewRecord } from "#src/index";

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
