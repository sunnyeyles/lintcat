import type { ChangedFile } from "@pr-review/github";
import { buildRepositoryIndex } from "@pr-review/index";
import type { ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import {
  changedPathsOf,
  evidenceProblem,
  MAX_EVIDENCE,
  withVerifiedEvidence,
  type EvidenceBase,
} from "#src/validate-evidence";

const index = buildRepositoryIndex({
  sha: "0".repeat(40),
  files: new Map([
    ["src/data/invoices.ts", "line 1\nline 2\nline 3\n"],
    ["src/data/customers.ts", "line 1\nline 2\n"],
    ["src/data/refunds.ts", "line 1\n"],
    ["src/data/long.ts", "x\n".repeat(20)],
  ]),
});

const changedFiles: ChangedFile[] = [
  { filename: "src/data/refunds.ts", status: "modified", additions: 1, deletions: 0 },
  {
    filename: "src/data/payments.ts",
    previous_filename: "src/data/charges.ts",
    status: "renamed",
    additions: 0,
    deletions: 0,
  },
];

const base: EvidenceBase = { index, changedPaths: changedPathsOf(changedFiles) };

function finding(evidence?: ReviewFinding["evidence"]): ReviewFinding {
  return {
    file: "src/data/refunds.ts",
    line: 1,
    category: "naming",
    severity: "medium",
    title: "Refund reads are named get*, not find*",
    explanation: "Every other data module names its reads find*.",
    confidence: 0.9,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

describe("changedPathsOf", () => {
  it("names both sides of a rename", () => {
    expect([...changedPathsOf(changedFiles)].sort()).toEqual([
      "src/data/charges.ts",
      "src/data/payments.ts",
      "src/data/refunds.ts",
    ]);
  });
});

describe("evidenceProblem", () => {
  it("accepts an unchanged file's line within its length", () => {
    expect(evidenceProblem({ file: "src/data/invoices.ts", line: 3 }, base)).toBeUndefined();
  });

  it("rejects a file the index does not hold", () => {
    expect(evidenceProblem({ file: "src/data/ghost.ts", line: 1 }, base)).toBe("missing-file");
  });

  it("rejects a file this pull request changes, either side of a rename", () => {
    expect(evidenceProblem({ file: "src/data/refunds.ts", line: 1 }, base)).toBe("changed-file");
    expect(evidenceProblem({ file: "src/data/charges.ts", line: 1 }, base)).toBe("changed-file");
  });

  it("rejects a line past the end of the file", () => {
    expect(evidenceProblem({ file: "src/data/invoices.ts", line: 4 }, base)).toBe(
      "line-out-of-range",
    );
  });

  it("applies only the changed-file rule without an index", () => {
    const blind: EvidenceBase = { index: undefined, changedPaths: base.changedPaths };
    expect(evidenceProblem({ file: "src/data/ghost.ts", line: 999 }, blind)).toBeUndefined();
    expect(evidenceProblem({ file: "src/data/refunds.ts", line: 1 }, blind)).toBe("changed-file");
  });
});

describe("withVerifiedEvidence", () => {
  it("keeps the valid entries in order and drops the rest", () => {
    const checked = withVerifiedEvidence(
      finding([
        { file: "src/data/invoices.ts", line: 2 },
        { file: "src/data/ghost.ts", line: 1 },
        { file: "src/data/refunds.ts", line: 1 },
        { file: "src/data/customers.ts", line: 9 },
        { file: "src/data/customers.ts", line: 1 },
      ]),
      base,
    );

    expect(checked.evidence).toEqual([
      { file: "src/data/invoices.ts", line: 2 },
      { file: "src/data/customers.ts", line: 1 },
    ]);
  });

  it("removes the field when no entry survives", () => {
    const checked = withVerifiedEvidence(finding([{ file: "src/data/ghost.ts", line: 1 }]), base);

    expect(checked).toEqual(finding());
    expect("evidence" in checked).toBe(false);
  });

  it("leaves a finding without evidence untouched", () => {
    const plain = finding();
    expect(withVerifiedEvidence(plain, base)).toBe(plain);
  });

  it("drops repeated entries and caps the rest at MAX_EVIDENCE", () => {
    const repeated = Array.from({ length: 3 }, () => ({ file: "src/data/long.ts", line: 1 }));
    expect(withVerifiedEvidence(finding(repeated), base).evidence).toEqual([
      { file: "src/data/long.ts", line: 1 },
    ]);

    const many = Array.from({ length: MAX_EVIDENCE + 3 }, (_, i) => ({
      file: "src/data/long.ts",
      line: i + 1,
    }));
    expect(withVerifiedEvidence(finding(many), base).evidence).toEqual(
      many.slice(0, MAX_EVIDENCE),
    );
  });
});
