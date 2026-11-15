import { describe, expect, it } from "vitest";

import type { TaskContract } from "#src/engine/contract";
import { validateReview } from "#src/engine/review";
import { sampleSpec } from "#src/engine/test-fixtures";

const contract = { spec: sampleSpec } as TaskContract;

describe("validateReview", () => {
  it("rejects output that misses the schema", () => {
    expect(validateReview({ verdict: "maybe", findings: [] }, [], contract)).toBeNull();
    expect(validateReview("approve", [], contract)).toBeNull();
  });

  it("keeps findings on changed files only and derives the verdict from what survives", () => {
    const review = validateReview(
      {
        verdict: "changes",
        summary: "s",
        findings: [
          { severity: "blocking", file: "/workspace/src/cli.ts", acceptanceId: "AC9", problem: "a" },
          { severity: "blocking", file: "src/elsewhere.ts", problem: "b" },
          { severity: "minor", file: "src/cli.ts", acceptanceId: "AC1", problem: "c" },
        ],
      },
      ["src/cli.ts"],
      contract,
    )!;
    expect(review.findings).toEqual([
      { severity: "blocking", file: "src/cli.ts", problem: "a" },
      { severity: "minor", file: "src/cli.ts", acceptanceId: "AC1", problem: "c" },
    ]);
    expect(review.dropped).toHaveLength(1);
    expect(review.verdict).toBe("changes");
  });

  it("approves when its only blocking finding was outside the diff", () => {
    const review = validateReview(
      { verdict: "changes", summary: "s", findings: [{ severity: "blocking", file: "README.md", problem: "x" }] },
      ["src/cli.ts"],
      contract,
    )!;
    expect(review).toMatchObject({ verdict: "approve", blocking: [], findings: [] });
  });
});
