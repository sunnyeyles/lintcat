/** The risk bands over a generated monorepo's real import graph, no model involved. */
import { buildRepositoryIndex, computeImpact } from "@pr-review/index";
import { describe, expect, it } from "vitest";

import { scoreRisk } from "#src/risk-score";

// Subpath exports keep every module importable without making it an entry point.
const manifest = (name: string): string =>
  JSON.stringify({ name, exports: { "./*": "./src/*.ts" } });

function testedModule(directory: string, stem: string): [string, string][] {
  return [
    [`${directory}/${stem}.ts`, "export const value = 1;\n"],
    [`${directory}/${stem}.test.ts`, `import { value } from "./${stem}";\n`],
  ];
}

function importers(
  count: number,
  prefix: string,
  specifier: string,
): [string, string][] {
  return Array.from({ length: count }, (_, at) => [
    `${prefix}-${String(at).padStart(2, "0")}.ts`,
    `import { value } from "${specifier}";\n`,
  ]);
}

const index = buildRepositoryIndex({
  sha: "0000000000000000000000000000000000000000",
  files: new Map([
    ["pnpm-workspace.yaml", "packages:\n  - packages/*\n"],
    ["packages/core/package.json", manifest("@acme/core")],
    ["packages/api/package.json", manifest("@acme/api")],
    ["packages/web/package.json", manifest("@acme/web")],
    ...testedModule("packages/core/src", "hub"),
    ...importers(30, "packages/core/src/hub-user", "./hub"),
    ...importers(25, "packages/api/src/hub-user", "@acme/core/hub"),
    ...importers(25, "packages/web/src/hub-user", "@acme/core/hub"),
    ...testedModule("packages/core/src", "shared"),
    ...importers(6, "packages/core/src/shared-user", "./shared"),
    ...importers(4, "packages/web/src/shared-user", "@acme/core/shared"),
    ...testedModule("packages/api/src", "local"),
    ...importers(10, "packages/api/src/local-user", "./local"),
    ...testedModule("packages/web/src", "leaf"),
    ...importers(2, "packages/web/src/leaf-user", "./leaf"),
  ]),
});

describe("risk calibration", () => {
  it.each([
    [
      "a hub 80 files import across 3 packages",
      "high",
      "packages/core/src/hub.ts",
      ["80 files depend on this change", "crosses 3 packages"],
    ],
    [
      "a module 10 files import across 2 packages",
      "medium",
      "packages/core/src/shared.ts",
      ["10 files depend on this change", "crosses 2 packages"],
    ],
    [
      "a module 10 files import within its package",
      "medium",
      "packages/api/src/local.ts",
      ["10 files depend on this change"],
    ],
    [
      "a tested leaf 2 files import",
      "low",
      "packages/web/src/leaf.ts",
      ["2 files depend on this change"],
    ],
  ] as const)("scores %s %s", (_, band, path, labels) => {
    const risk = scoreRisk(computeImpact(index, [{ path, status: "modified" }]));

    expect(risk.band).toBe(band);
    expect(risk.factors.map((factor) => factor.label)).toEqual(labels);
  });
});
