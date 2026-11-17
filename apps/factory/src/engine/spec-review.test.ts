import { describe, expect, it } from "vitest";

import { matchResolutions, needsResolution, resolvableList, validateSpecReview } from "#src/engine/spec-review";

const paraphrase = { proposes: "Adds a flag", existingSystem: "A CLI in src/cli.ts" };
const finding = (severity: string, field: string, problem: string, lens = "readiness", evidence: string[] = []) => ({ severity, lens, field, problem, evidence });
const feature = { category: "feature" } as const;

describe("validateSpecReview", () => {
  it("rejects output that misses the schema", () => {
    expect(validateSpecReview({ findings: [] }, "v", feature)).toBeNull();
    expect(validateSpecReview({ paraphrase, findings: [finding("fatal", "plan", "x")] }, "v", feature)).toBeNull();
  });

  it("dedupes, orders by severity, then numbers", () => {
    const review = validateSpecReview(
      {
        paraphrase,
        findings: [finding("nit", "title", "wordy"), finding("blocker", "plan", "No file named"), finding("blocker", " plan ", "no file named"), finding("major", "AC1", "untestable")],
      },
      "spec-reviewer@2",
      feature,
    );
    expect(review?.findings.map((f) => [f.id, f.severity, f.field])).toEqual([
      ["F1", "blocker", "plan"],
      ["F2", "major", "AC1"],
      ["F3", "nit", "title"],
    ]);
    expect(review?.promptVersion).toBe("spec-reviewer@2");
  });

  it("caps the findings", () => {
    const findings = Array.from({ length: 20 }, (_, i) => finding("major", "plan", `gap ${i}`));
    expect(validateSpecReview({ paraphrase, findings }, "v", feature)?.findings).toHaveLength(12);
  });

  it("keeps a scope finding only with cited evidence", () => {
    const cited = finding("blocker", "category", "refactor", "scope", [" src/a.ts:10 ", ""]);
    const uncited = finding("blocker", "risk", "high", "scope", ["  "]);
    const review = validateSpecReview({ paraphrase, findings: [cited, uncited] }, "v", feature);
    expect(review?.findings).toMatchObject([{ field: "category", evidence: ["src/a.ts:10"] }]);
  });

  it("keeps only scope findings on a quick change", () => {
    const scope = finding("major", "category", "bugfix", "scope", ["src/a.ts:1"]);
    const review = validateSpecReview({ paraphrase, findings: [finding("blocker", "plan", "gap"), scope] }, "v", { category: "quick" });
    expect(review?.findings.map((f) => f.lens)).toEqual(["scope"]);
  });
});

describe("resolution", () => {
  const scope = finding("blocker", "category", "refactor", "scope", ["src/a.ts:1"]);
  const review = validateSpecReview({ paraphrase, findings: [finding("blocker", "plan", "a"), scope, finding("nit", "title", "b")] }, "v", feature)!;

  it("is needed for a non-scope finding above a nit", () => {
    expect(needsResolution(review)).toBe(true);
    expect(needsResolution({ ...review, findings: review.findings.filter((f) => f.lens === "scope" || f.severity === "nit") })).toBe(false);
  });

  it("never sends scope findings to discovery", () => {
    expect(resolvableList(review)).toBe("- F1 [blocker, readiness] plan: a\n- F3 [nit, readiness] title: b");
  });

  it("keeps one answer per resolvable finding", () => {
    const matched = matchResolutions(review, [
      { finding: "F1", action: "fix", note: "named the file" },
      { finding: "F1", action: "contest", note: "again" },
      { finding: "F2", action: "fix", note: "scope is not discovery's" },
      { finding: "F9", action: "fix", note: "invented" },
      { finding: " F3", action: "decline", note: "nit" },
    ]);
    expect(matched.map((r) => [r.finding.id, r.action])).toEqual([
      ["F1", "fix"],
      ["F3", "decline"],
    ]);
  });
});
