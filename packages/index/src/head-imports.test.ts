import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import { resolveHeadImports } from "#src/head-imports";

const base = buildRepositoryIndex({
  sha: "0000000000000000000000000000000000000000",
  files: new Map([
    ["package.json", JSON.stringify({ name: "app", imports: { "#src/*": "./src/*" } })],
    ["src/page.ts", 'import { cn } from "#src/cn";\n'],
    ["src/cn.ts", "export const cn = 1;\n"],
    ["src/old.ts", "export const old = 1;\n"],
    ["README.md", "# app\n"],
  ]),
});

const tree = (
  contents: Record<string, string>,
  added: string[] = [],
  removed: string[] = [],
) => ({
  contents: new Map(Object.entries(contents)),
  added: new Set(added),
  removed: new Set(removed),
});

describe("resolveHeadImports", () => {
  it("resolves an import of a file outside the diff", () => {
    const imports = resolveHeadImports(
      base,
      tree({ "src/page.ts": 'import { cn } from "#src/cn";\nimport React from "react";\n' }),
    );

    expect(imports.get("src/page.ts")).toEqual([
      { path: "src/cn.ts", internal: true },
      { internal: false },
    ]);
  });

  it("resolves a file the pull request adds, and not one it removes", () => {
    const imports = resolveHeadImports(
      base,
      tree(
        { "src/page.ts": 'import { a } from "./fresh";\nimport { old } from "./old";\n' },
        ["src/fresh.ts"],
        ["src/old.ts"],
      ),
    );

    expect(imports.get("src/page.ts")).toEqual([
      { path: "src/fresh.ts", internal: true },
      { internal: true },
    ]);
  });

  it("skips files in languages the index does not parse", () => {
    const imports = resolveHeadImports(base, tree({ "README.md": "# changed\n" }));

    expect(imports.has("README.md")).toBe(false);
  });
});
