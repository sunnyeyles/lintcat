import { describe, expect, it } from "vitest";

import { matchResolutions, needsResolution, shouldReviewSpec, validateSpecReview } from "#src/engine/spec-review";
import { sampleSpec } from "#src/engine/test-fixtures";

const paraphrase = { proposes: "Adds a flag", existingSystem: "A CLI in src/cli.ts" };
const finding = (severity: string, field: string, problem: string) => ({ severity, lens: "readiness", field, problem });

describe("validateSpecReview", () => {
  it("rejects output that misses the schema", () => {
    expect(validateSpecReview({ findings: [] }, "v")).toBeNull();
    expect(validateSpecReview({ paraphrase, findings: [finding("fatal", "plan", "x")] }, "v")).toBeNull();
  });

  it("dedupes, orders by severity, then numbers", () => {
    const review = validateSpecReview(
      {
        paraphrase,
        findings: [finding("nit", "title", "wordy"), finding("blocker", "plan", "No file named"), finding("blocker", " plan ", "no file named"), finding("major", "AC1", "untestable")],
      },
      "spec-reviewer@1",
    );
    expect(review?.findings.map((f) => [f.id, f.severity, f.field])).toEqual([
      ["F1", "blocker", "plan"],
      ["F2", "major", "AC1"],
      ["F3", "nit", "title"],
    ]);
    expect(review?.promptVersion).toBe("spec-reviewer@1");
  });

  it("caps the findings", () => {
    const findings = Array.from({ length: 20 }, (_, i) => finding("major", "plan", `gap ${i}`));
    expect(validateSpecReview({ paraphrase, findings }, "v")?.findings).toHaveLength(12);
  });
});

describe("resolution", () => {
  const review = validateSpecReview({ paraphrase, findings: [finding("blocker", "plan", "a"), finding("nit", "title", "b")] }, "v")!;

  it("is needed for anything above a nit", () => {
    expect(needsResolution(review)).toBe(true);
    expect(needsResolution({ ...review, findings: review.findings.filter((f) => f.severity === "nit") })).toBe(false);
  });

  it("keeps one answer per issued finding", () => {
    const matched = matchResolutions(review, [
      { finding: "F1", action: "fix", note: "named the file" },
      { finding: "F1", action: "contest", note: "again" },
      { finding: "F9", action: "fix", note: "invented" },
      { finding: " F2", action: "decline", note: "nit" },
    ]);
    expect(matched.map((r) => [r.finding.id, r.action])).toEqual([
      ["F1", "fix"],
      ["F2", "decline"],
    ]);
  });

  it("skips quick changes only", () => {
    expect(shouldReviewSpec(sampleSpec)).toBe(false);
    expect(shouldReviewSpec({ ...sampleSpec, category: "feature" })).toBe(true);
    expect(shouldReviewSpec({ ...sampleSpec, category: "bugfix" })).toBe(true);
  });
});
