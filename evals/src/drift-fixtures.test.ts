/** The drift fixtures are solvable under validation: the evidence a reviewer would cite survives it. */
import { changedPaths } from "@pr-review/github";
import { createSilentLogger } from "@pr-review/logging";
import { buildReviewIndex, validateFindings } from "@pr-review/reviewer";
import type { ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { loadFixture, type LoadedFixture } from "#src/fixture";
import { createFixtureClient } from "#src/fixture-client";

function lineOf(files: ReadonlyMap<string, string>, file: string, marker: string): number {
  const at = (files.get(file) ?? "").split("\n").findIndex((line) => line.includes(marker));
  if (at === -1) {
    throw new Error(`${marker} is not in ${file}`);
  }
  return at + 1;
}

async function survivors(fixture: LoadedFixture, finding: ReviewFinding) {
  const { pullRequest } = fixture.context;
  const { index } = await buildReviewIndex({
    client: createFixtureClient(fixture).client,
    target: {
      owner: fixture.context.owner,
      repo: fixture.context.repo,
      pullRequestNumber: pullRequest.number,
      headSha: pullRequest.headSha,
    },
    baseSha: pullRequest.baseSha,
    enabled: true,
    logger: createSilentLogger(),
  });
  return validateFindings([finding], fixture.changedFiles, [finding.category], {
    index,
    changedPaths: changedPaths(fixture.changedFiles),
  });
}

describe("naming-drift-data-reads", () => {
  const fixture = loadFixture("naming-drift-data-reads");

  it("keeps a finding that cites two sibling reads named find*", async () => {
    const finding: ReviewFinding = {
      file: "src/data/credit-notes.ts",
      line: lineOf(fixture.headFiles, "src/data/credit-notes.ts", "function getCreditNoteById"),
      category: "naming",
      severity: "low",
      title: "Credit note reads are named get*/fetch*, not find*/list*",
      explanation: "Every other data module names a single read find* and a list list*For*.",
      evidence: [
        {
          file: "src/data/invoices.ts",
          line: lineOf(fixture.baseFiles, "src/data/invoices.ts", "function findInvoice("),
        },
        {
          file: "src/data/payments.ts",
          line: lineOf(fixture.baseFiles, "src/data/payments.ts", "function findPayment("),
        },
      ],
      confidence: 0.9,
    };

    expect(await survivors(fixture, finding)).toEqual([finding]);
  });

  it("drops one citing the pull request's own files as the convention", async () => {
    const finding: ReviewFinding = {
      file: "src/data/credit-notes.ts",
      category: "naming",
      severity: "low",
      title: "Credit note reads follow the service",
      explanation: "The service already calls them this way.",
      evidence: [
        { file: "src/services/credit-notes.ts", line: 2 },
        { file: "src/data/invoices.ts", line: 1 },
      ],
      confidence: 0.9,
    };

    expect(await survivors(fixture, finding)).toEqual([]);
  });
});
