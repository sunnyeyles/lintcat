import { describe, expect, it } from "vitest";

import { reviewRecordSchema, type ReviewRecord } from "#src/index";

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
