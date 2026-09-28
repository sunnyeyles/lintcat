import { describe, expect, it } from "vitest";

import {
  MAX_EVIDENCE_ENTRIES,
  reviewFindingSchema,
  type ReviewFinding,
} from "#src/review-finding";

const validFinding: ReviewFinding = {
  file: "src/auth/session.ts",
  line: 84,
  category: "security",
  severity: "high",
  title: "Missing tenant validation",
  explanation:
    "Missing tenant validation could allow access to another tenant's session.",
  suggestedFix: "Filter the session query by the authenticated tenant id.",
  confidence: 0.9,
};

describe("reviewFindingSchema", () => {
  it("accepts a fully populated finding", () => {
    const result = reviewFindingSchema.safeParse(validFinding);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFinding);
    }
  });

  it("accepts a finding without the optional line and suggestedFix", () => {
    const {
      line: _line,
      suggestedFix: _suggestedFix,
      ...fileLevel
    } = validFinding;
    const result = reviewFindingSchema.safeParse(fileLevel);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.line).toBeUndefined();
      expect(result.data.suggestedFix).toBeUndefined();
    }
  });

  it("accepts any category slug, because the agent set is configurable", () => {
    // Membership is checked against the run's agents, not here.
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, category: "performance" })
        .success,
    ).toBe(true);
  });

  it("rejects a category that is not a lowercase slug", () => {
    for (const category of ["", "Style", "sty le", "9lives", "style!"]) {
      expect(
        reviewFindingSchema.safeParse({ ...validFinding, category }).success,
      ).toBe(false);
    }
  });

  it("rejects an unknown severity", () => {
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, severity: "critical" })
        .success,
    ).toBe(false);
  });

  it("rejects confidence outside the 0..1 range", () => {
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, confidence: 1.5 })
        .success,
    ).toBe(false);
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, confidence: -0.1 })
        .success,
    ).toBe(false);
  });

  it("accepts the confidence boundaries 0 and 1", () => {
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, confidence: 0 }).success,
    ).toBe(true);
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, confidence: 1 }).success,
    ).toBe(true);
  });

  it("rejects a non-positive or non-integer line", () => {
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, line: 0 }).success,
    ).toBe(false);
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, line: -3 }).success,
    ).toBe(false);
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, line: 4.2 }).success,
    ).toBe(false);
  });

  it("rejects empty file, title, or explanation", () => {
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, file: "" }).success,
    ).toBe(false);
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, title: "" }).success,
    ).toBe(false);
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, explanation: "" })
        .success,
    ).toBe(false);
  });

  it("rejects findings with missing required fields", () => {
    const { confidence: _confidence, ...withoutConfidence } = validFinding;
    expect(reviewFindingSchema.safeParse(withoutConfidence).success).toBe(false);
    const { category: _category, ...withoutCategory } = validFinding;
    expect(reviewFindingSchema.safeParse(withoutCategory).success).toBe(false);
  });

  it("strips unknown fields rather than passing them through", () => {
    const result = reviewFindingSchema.safeParse({
      ...validFinding,
      extra: "field",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFinding);
    }
  });

  it("accepts evidence as a list of file and line references", () => {
    const evidence = [
      { file: "src/auth/tokens.ts", line: 12 },
      { file: "docs/auth.md", line: 40 },
    ];
    const result = reviewFindingSchema.safeParse({ ...validFinding, evidence });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence).toEqual(evidence);
    }
  });

  it("rejects evidence without a positive line, or past the entry cap", () => {
    for (const entry of [{ file: "src/a.ts" }, { file: "src/a.ts", line: 0 }, { file: "", line: 3 }]) {
      expect(
        reviewFindingSchema.safeParse({ ...validFinding, evidence: [entry] }).success,
      ).toBe(false);
    }
    const tooMany = Array.from({ length: MAX_EVIDENCE_ENTRIES + 1 }, (_, i) => ({
      file: "src/a.ts",
      line: i + 1,
    }));
    expect(
      reviewFindingSchema.safeParse({ ...validFinding, evidence: tooMany }).success,
    ).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(reviewFindingSchema.safeParse("not a finding").success).toBe(false);
    expect(reviewFindingSchema.safeParse(null).success).toBe(false);
  });
});
