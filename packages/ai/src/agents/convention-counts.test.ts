import type { ChangedFile } from "@pr-review/github";
import { buildRepositoryIndex } from "@pr-review/index";
import { describe, expect, it } from "vitest";

import { baseSha, context } from "#src/agent-test-support";
import { renderConventionCounts } from "#src/agents/convention-counts";
import { buildOpeningPrompt } from "#src/agents/opening-prompt";

const kebab = buildRepositoryIndex({
  sha: baseSha,
  files: new Map(
    ["credit-notes", "customer-accounts", "payment-methods", "tax-rates"].map((name) => [
      `src/data/${name}.ts`,
      'import { pool } from "../db/pool.js";\nexport const read = pool;\n',
    ]),
  ).set("src/db/pool.ts", "export const pool = {};\n"),
});

const added: ChangedFile = {
  filename: "src/data/refundRequests.ts",
  status: "added",
  additions: 1,
  deletions: 0,
};

describe("renderConventionCounts", () => {
  it("lists each clear convention under the changed file it was measured for", () => {
    expect(renderConventionCounts(kebab, { changedFiles: [added] }, 50)).toEqual([
      "<convention_counts>",
      "Measured over the sibling files at the base commit; a convention is listed only when at least 80% of the siblings it could be read from agree. Whether the changed file follows it is for you to check.",
      'Cite one as evidence with {"convention": "<name>", "file": "<changed file>"}. It stands for the siblings it counts, so you need not read them to cite it.',
      "- src/data/refundRequests.ts:",
      "  - file-name-casing: all 4 siblings use kebab-case file names",
      "  - export-style: all 4 siblings use named exports only",
      "  - import-path: all 4 siblings import their own package by relative path",
      "  - import-extension: all 4 siblings write the file extension on imports from their own package",
      "</convention_counts>",
      "",
    ]);
  });

  it("renders nothing without an index, or where the siblings share no convention", () => {
    expect(renderConventionCounts(undefined, { changedFiles: [added] }, 50)).toEqual([]);

    const mixed = buildRepositoryIndex({
      sha: baseSha,
      files: new Map([
        ["src/lib/Slug.ts", "export default function slug() {}\n"],
        ["src/lib/dateUtils.ts", "export const format = 1;\n"],
        ["src/lib/id_generator.ts", "module.exports = {};\n"],
      ]),
    });
    const percent: ChangedFile = { ...added, filename: "src/lib/percent.ts" };
    expect(renderConventionCounts(mixed, { changedFiles: [percent] }, 50)).toEqual([]);
  });

  it("skips removed files and counts past the listing cap", () => {
    const removed: ChangedFile = { ...added, status: "removed" };
    expect(renderConventionCounts(kebab, { changedFiles: [removed] }, 50)).toEqual([]);
    expect(renderConventionCounts(kebab, { changedFiles: [added] }, 0)).toEqual([]);
  });
});

describe("the opening message", () => {
  it("carries the counts after the sibling files and before the diff", () => {
    const opening = buildOpeningPrompt(
      { ...context, changedFiles: [added] },
      { index: kebab, budget: { maxListedFiles: 50, tools: true } },
    );

    expect(opening).toContain("  - file-name-casing: all 4 siblings use kebab-case file names");
    expect(opening.indexOf("</sibling_files>")).toBeLessThan(
      opening.indexOf("<convention_counts>"),
    );
    expect(opening.indexOf("</convention_counts>")).toBeLessThan(opening.indexOf("<diff>"));
  });
});
