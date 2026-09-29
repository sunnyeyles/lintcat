import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import type { ImpactChange } from "#src/impact";
import { buildChangeOverlay } from "#src/overlay";

const headSha = "1111111111111111111111111111111111111111";

const base = buildRepositoryIndex({
  sha: "0000000000000000000000000000000000000000",
  files: new Map([
    ["src/page.ts", 'import { util } from "./util";\nimport { old } from "./old";\n'],
    ["src/util.ts", "export const util = 1;\n"],
    ["src/old.ts", 'import { util } from "./util";\nexport const old = 1;\n'],
    ["src/other.ts", 'import { util } from "./util";\n'],
    ["README.md", "# app\n"],
  ]),
});

function overlay(
  changes: ImpactChange[],
  contents: Record<string, string>,
  partial?: boolean,
) {
  return buildChangeOverlay(base, {
    headSha,
    changes,
    contents: new Map(Object.entries(contents)),
    partial,
  });
}

describe("buildChangeOverlay", () => {
  it("adds every resolved import of a file the pull request adds", () => {
    const result = overlay([{ path: "src/fresh.ts", status: "added" }], {
      "src/fresh.ts": 'import { util } from "./util";\nimport React from "react";\n',
    });

    expect(result.added).toEqual([{ from: "src/fresh.ts", to: "src/util.ts" }]);
    expect(result.removed).toEqual([]);
    expect(result.files).toEqual([{ path: "src/fresh.ts", status: "added" }]);
    expect(result.unresolvedImportCount).toBe(0);
    expect(result.headSha).toBe(headSha);
    expect(result.partial).toBe(false);
  });

  it("diffs a modified file's imports against the base", () => {
    const result = overlay([{ path: "src/page.ts", status: "modified" }], {
      "src/page.ts": 'import { util } from "./util";\nimport { other } from "./other";\n',
    });

    expect(result.added).toEqual([{ from: "src/page.ts", to: "src/other.ts" }]);
    expect(result.removed).toEqual([{ from: "src/page.ts", to: "src/old.ts" }]);
  });

  it("removes every base import of a removed file, and one naming it from a changed importer", () => {
    const result = overlay(
      [
        { path: "src/old.ts", status: "removed" },
        { path: "src/page.ts", status: "modified" },
      ],
      { "src/page.ts": 'import { util } from "./util";\nimport { old } from "./old";\n' },
    );

    expect(result.removed).toEqual([
      { from: "src/old.ts", to: "src/util.ts" },
      { from: "src/page.ts", to: "src/old.ts" },
    ]);
    expect(result.unresolvedImportCount).toBe(1);
  });

  it("compares a renamed file from its new path and maps a renamed target", () => {
    const result = overlay(
      [{ path: "src/utils.ts", status: "renamed", previousPath: "src/util.ts" }, { path: "src/page.ts", status: "modified" }],
      { "src/page.ts": 'import { util } from "./utils";\nimport { old } from "./old";\n', "src/utils.ts": "" },
    );

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.files[0]).toEqual({
      path: "src/utils.ts",
      status: "renamed",
      previousPath: "src/util.ts",
    });
  });

  it("counts internal imports that resolve to nothing, not third-party ones", () => {
    const result = overlay([{ path: "src/fresh.ts", status: "added" }], {
      "src/fresh.ts": 'import { a } from "./missing";\nimport z from "zod";\n',
    });

    expect(result.added).toEqual([]);
    expect(result.unresolvedImportCount).toBe(1);
  });

  it("leaves a file with no HEAD contents undiffed and passes partial through", () => {
    const result = overlay([{ path: "src/page.ts", status: "modified" }], {}, true);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.files).toEqual([{ path: "src/page.ts", status: "modified" }]);
    expect(result.partial).toBe(true);
  });

  it("skips files in languages the index does not parse", () => {
    const result = overlay([{ path: "README.md", status: "modified" }], { "README.md": "# new\n" });

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});
