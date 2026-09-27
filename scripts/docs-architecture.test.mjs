import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildArchitecture, PAGE, readArchitecture } from "./docs-architecture.mjs";

function workspace(packages) {
  const root = mkdtempSync(join(tmpdir(), "docs-architecture-"));
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n  - packages/*\nonlyBuiltDependencies:\n  - esbuild\n",
  );
  for (const [dir, pkg] of Object.entries(packages)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(pkg));
  }
  return root;
}

const pkg = (name, dependencies = {}) => ({
  name: `@pr-review/${name}`,
  description: `the ${name} package`,
  dependencies,
});

describe("docs architecture map", () => {
  it("matches every workspace package.json", () => {
    const page = readFileSync(PAGE, "utf8");
    expect(readArchitecture(page), "run `pnpm docs:map`").toEqual(buildArchitecture());
  });

  it("layers packages by their longest import chain and drops tooling", () => {
    const root = workspace({
      "apps/web": pkg("web", { "@pr-review/core": "workspace:*", react: "^19" }),
      "packages/core": pkg("core", { "@pr-review/base": "workspace:*" }),
      "packages/base": pkg("base", { "@pr-review/eslint-config": "workspace:*" }),
      "packages/eslint-config": pkg("eslint-config"),
    });
    const { nodes } = buildArchitecture(root);
    expect(nodes.map(({ id, kind, layer, imports, importedBy }) => ({ id, kind, layer, imports, importedBy }))).toEqual([
      { id: "web", kind: "entry", layer: 2, imports: ["core"], importedBy: [] },
      { id: "base", kind: "package", layer: 0, imports: [], importedBy: ["core"] },
      { id: "core", kind: "package", layer: 1, imports: ["base"], importedBy: ["web"] },
    ]);
  });

  it("refuses a package with no description", () => {
    const root = workspace({ "packages/bare": { name: "@pr-review/bare" } });
    expect(() => buildArchitecture(root)).toThrow('packages/bare/package.json needs a "description"');
  });
});
