/** The blast radius of a change, over inline file maps. */
import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import {
  computeImpact,
  MAX_IMPACT_FILES,
  type ImpactChange,
} from "#src/impact";

const sha = "0000000000000000000000000000000000000000";

function graphIndex(files: Record<string, string>, truncated = false) {
  return buildRepositoryIndex({
    sha,
    truncated,
    files: new Map(Object.entries(files)),
  });
}

function modified(...paths: string[]): ImpactChange[] {
  return paths.map((path) => ({ path, status: "modified" }));
}

/** `src/util.ts` imported by a chain of three and a fan of two, plus a test. */
const hubTree = {
  "src/util.ts": "export const util = 1;\n",
  "src/leaf.ts": "export const leaf = 1;\n",
  "src/a.ts": 'import { util } from "./util";\n',
  "src/b.ts": 'import "./a";\n',
  "src/c.ts": 'import "./b";\n',
  "src/fan-one.ts": 'import { util } from "./util";\nimport "./leaf";\n',
  "src/fan-two.ts": 'import * as util from "./util";\n',
  "src/util.test.ts": 'import { util } from "./util";\n',
};

describe("computeImpact", () => {
  it("finds nothing downstream of a leaf nobody imports", () => {
    const impact = computeImpact(graphIndex(hubTree), modified("src/c.ts"));

    expect(impact.direct).toEqual([]);
    expect(impact.transitive).toEqual([]);
    expect(impact.hubs).toEqual([]);
    expect(impact.untested).toEqual(["src/c.ts"]);
    expect(impact.partial).toBe(false);
    expect(impact.counts.transitive).toBe(0);
  });

  it("reaches every importer of a hub, sorted, and ranks it first", () => {
    const impact = computeImpact(
      graphIndex(hubTree),
      modified("src/leaf.ts", "src/util.ts"),
    );

    expect(impact.direct).toEqual(["src/a.ts", "src/fan-one.ts", "src/fan-two.ts"]);
    expect(impact.transitive).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/fan-one.ts",
      "src/fan-two.ts",
    ]);
    expect(impact.hubs).toEqual([
      { path: "src/util.ts", dependents: 5 },
      { path: "src/leaf.ts", dependents: 1 },
    ]);
    expect(impact.untested).toEqual(["src/leaf.ts"]);
  });

  it("leaves test importers out of the dependents", () => {
    const impact = computeImpact(graphIndex(hubTree), modified("src/util.ts"));

    expect(impact.transitive).not.toContain("src/util.test.ts");
    expect(impact.direct).not.toContain("src/util.test.ts");
    expect(impact.counts.direct).toBe(3);
  });

  it("stops at the depth cap", () => {
    const impact = computeImpact(
      graphIndex({
        ...hubTree,
        "src/d.ts": 'import "./c";\n',
      }),
      modified("src/util.ts"),
    );

    expect(impact.transitive).toContain("src/c.ts");
    expect(impact.transitive).not.toContain("src/d.ts");
  });

  it("flags a changed file in a cycle and excludes changed files from dependents", () => {
    const impact = computeImpact(
      graphIndex({
        "src/a.ts": 'import "./b";\n',
        "src/b.ts": 'import "./a";\n',
        "src/entry.ts": 'import "./a";\n',
      }),
      modified("src/a.ts"),
    );

    expect(impact.inCycle).toEqual(["src/a.ts"]);
    expect(impact.transitive).toEqual(["src/b.ts", "src/entry.ts"]);
    expect(impact.counts.inCycle).toBe(1);
  });

  it("lists the imports a removed file leaves broken, tests included", () => {
    const impact = computeImpact(graphIndex(hubTree), [
      { path: "src/util.ts", status: "removed" },
    ]);

    expect(impact.brokenImporters).toEqual([
      { from: "src/a.ts", to: "src/util.ts", line: 1 },
      { from: "src/fan-one.ts", to: "src/util.ts", line: 1 },
      { from: "src/fan-two.ts", to: "src/util.ts", line: 1 },
      { from: "src/util.test.ts", to: "src/util.ts", line: 1 },
    ]);
    expect(impact.counts.brokenImporters).toBe(4);
    expect(impact.untested).toEqual([]);
  });

  it("reads a renamed file's importers at its old path", () => {
    const impact = computeImpact(graphIndex(hubTree), [
      { path: "src/utils.ts", status: "renamed", previousPath: "src/util.ts" },
      { path: "src/fan-two.ts", status: "removed" },
    ]);

    expect(impact.brokenImporters.map((edge) => edge.from)).toEqual([
      "src/a.ts",
      "src/fan-one.ts",
      "src/util.test.ts",
    ]);
    expect(impact.direct).toEqual(["src/a.ts", "src/fan-one.ts"]);
  });

  it("names every package the change crosses into", () => {
    const impact = computeImpact(
      graphIndex({
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
        "packages/core/package.json": JSON.stringify({
          name: "@acme/core",
          exports: { ".": "./src/index.ts" },
        }),
        "packages/core/src/index.ts": 'export * from "./util";\n',
        "packages/core/src/util.ts": "export const util = 1;\n",
        "packages/app/package.json": JSON.stringify({ name: "@acme/app" }),
        "packages/app/src/main.ts": 'import { util } from "@acme/core";\n',
      }),
      modified("packages/core/src/util.ts"),
    );

    expect(impact.transitive).toEqual([
      "packages/app/src/main.ts",
      "packages/core/src/index.ts",
    ]);
    expect(impact.packages).toEqual(["@acme/app", "@acme/core"]);
    expect(impact.entryPoints).toEqual(["packages/core/src/index.ts"]);
  });

  it("counts an entry point that is itself changed", () => {
    const impact = computeImpact(
      graphIndex({ "app/dashboard/page.tsx": "export default 1;\n" }),
      modified("app/dashboard/page.tsx"),
    );

    expect(impact.entryPoints).toEqual(["app/dashboard/page.tsx"]);
  });

  it("is partial over a truncated index", () => {
    const impact = computeImpact(
      graphIndex(hubTree, true),
      modified("src/util.ts"),
    );

    expect(impact.partial).toBe(true);
  });

  it("is partial when a changed source is in a language the index does not parse", () => {
    const tree = { ...hubTree, "app/main.py": "import os\n", "README.md": "# hi\n" };

    expect(computeImpact(graphIndex(tree), modified("app/main.py")).partial).toBe(
      true,
    );
    expect(computeImpact(graphIndex(tree), modified("README.md")).partial).toBe(
      false,
    );
  });

  it("treats an added source as tested when the pull request adds its test", () => {
    const impact = computeImpact(graphIndex(hubTree), [
      { path: "src/new.ts", status: "added" },
      { path: "src/new.test.ts", status: "added" },
      { path: "src/other.ts", status: "added" },
    ]);

    expect(impact.untested).toEqual(["src/other.ts"]);
    expect(impact.transitive).toEqual([]);
  });

  it("caps each list but keeps the true count", () => {
    const files: Record<string, string> = {
      "src/core.ts": "export const core = 1;\n",
    };
    for (let at = 0; at < MAX_IMPACT_FILES + 50; at += 1) {
      files[`src/user-${String(at).padStart(4, "0")}.ts`] = 'import "./core";\n';
    }
    const impact = computeImpact(graphIndex(files), modified("src/core.ts"));

    expect(impact.direct).toHaveLength(MAX_IMPACT_FILES);
    expect(impact.counts.direct).toBe(MAX_IMPACT_FILES + 50);
    expect(impact.counts.transitive).toBe(MAX_IMPACT_FILES + 50);
    expect(impact.direct[0]).toBe("src/user-0000.ts");
    expect(impact.hubs).toEqual([
      { path: "src/core.ts", dependents: MAX_IMPACT_FILES + 50 },
    ]);
  });
});
