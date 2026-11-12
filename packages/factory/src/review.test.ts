import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TaskContract } from "#src/contract";
import { assessEscalation } from "#src/escalation";
import { validateReview } from "#src/review";
import { sampleSpec } from "#src/test-fixtures";

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

describe("assessEscalation", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "factory-escalation-"));
  writeFileSync(path.join(repo, "package.json"), "{}");
  for (const pkg of ["a", "b"]) {
    mkdirSync(path.join(repo, "packages", pkg, "src"), { recursive: true });
    writeFileSync(path.join(repo, "packages", pkg, "package.json"), "{}");
  }

  it("leaves a run within its estimate alone", () => {
    expect(assessEscalation(repo, ["packages/a/src/x.ts", "packages/a/src/x.test.ts"], 2)).toEqual({ kind: "none" });
  });

  it("adds a review when the diff grows or crosses packages", () => {
    expect(assessEscalation(repo, ["a", "b", "c", "d"], 1)).toMatchObject({ kind: "review", reason: expect.stringMatching(/4 files/) });
    expect(assessEscalation(repo, ["packages/a/src/x.ts", "packages/b/src/y.ts"], 2)).toMatchObject({
      kind: "review",
      reason: expect.stringMatching(/crosses 2 packages \(packages\/a, packages\/b\)/),
    });
  });

  it("blocks a diff far beyond the approved scope", () => {
    expect(assessEscalation(repo, Array.from({ length: 11 }, (_, i) => `f${i}`), 1)).toMatchObject({ kind: "blocked" });
  });
});
