/** The entry-point rules, over inline file maps. */
import { describe, expect, it } from "vitest";

import { collectEntryPoints, isEntryPoint } from "#src/entry-points";
import { classifyFileRole } from "#src/roles";
import { readWorkspace } from "#src/workspace";

function entriesOf(files: Record<string, string>) {
  const map = new Map(Object.entries(files));
  return collectEntryPoints(readWorkspace(map), (path) => map.has(path));
}

/** The one question the dead-file flag asks of a path. */
function entry(files: Record<string, string>, path: string): boolean {
  return isEntryPoint(path, classifyFileRole(path), entriesOf(files));
}

const emptyEntries = { declared: new Set<string>(), indexDirectories: new Set<string>() };

describe("manifest entry points", () => {
  it("takes the exports target of a package", () => {
    const files = {
      "packages/core/package.json": JSON.stringify({
        name: "@acme/core",
        exports: { ".": "./src/main.ts" },
      }),
      "packages/core/src/main.ts": "export const core = 1;\n",
      "packages/core/src/helper.ts": "export const help = 1;\n",
    };

    expect(entry(files, "packages/core/src/main.ts")).toBe(true);
    expect(entry(files, "packages/core/src/helper.ts")).toBe(false);
  });

  it("takes every subpath and condition of an exports map", () => {
    const files = {
      "package.json": JSON.stringify({
        name: "acme",
        exports: {
          ".": { import: "./src/esm.ts", require: "./src/cjs.ts" },
          "./extra": ["./src/extra.ts"],
        },
      }),
      "src/esm.ts": "",
      "src/cjs.ts": "",
      "src/extra.ts": "",
    };
    const declared = entriesOf(files).declared;

    expect([...declared].sort()).toEqual([
      "src/cjs.ts",
      "src/esm.ts",
      "src/extra.ts",
    ]);
  });

  it("takes main and module", () => {
    const files = {
      "package.json": JSON.stringify({
        name: "acme",
        main: "src/legacy.ts",
        module: "src/modern.ts",
      }),
      "src/legacy.ts": "",
      "src/modern.ts": "",
    };

    expect(entry(files, "src/legacy.ts")).toBe(true);
    expect(entry(files, "src/modern.ts")).toBe(true);
  });

  it("takes every command of a bin map", () => {
    const files = {
      "package.json": JSON.stringify({
        name: "acme",
        bin: { acme: "./cli/run.ts", other: "./cli/other.ts" },
      }),
      "cli/run.ts": "",
      "cli/other.ts": "",
    };

    expect(entry(files, "cli/run.ts")).toBe(true);
    expect(entry(files, "cli/other.ts")).toBe(true);
  });

  it("takes a bin given as one string", () => {
    const files = {
      "package.json": JSON.stringify({ name: "acme", bin: "./cli/run.ts" }),
      "cli/run.ts": "",
    };

    expect(entry(files, "cli/run.ts")).toBe(true);
  });

  it("follows a written .js target to the TypeScript source", () => {
    const files = {
      "package.json": JSON.stringify({ name: "acme", main: "./src/index.js" }),
      "src/index.ts": "",
    };

    expect(entriesOf(files).declared.has("src/index.ts")).toBe(true);
  });

  it("ignores a target no file in the tree matches", () => {
    const files = {
      "package.json": JSON.stringify({ name: "acme", main: "./dist/index.js" }),
      "src/index.ts": "",
    };

    expect([...entriesOf(files).declared]).toEqual([]);
  });

  it("reads a manifest the workspace patterns do not claim", () => {
    const files = {
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "apps/web/package.json": JSON.stringify({
        name: "web",
        main: "./server.ts",
      }),
      "apps/web/server.ts": "",
    };

    expect(entry(files, "apps/web/server.ts")).toBe(true);
  });
});

describe("index files", () => {
  const files = {
    "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
    "packages/core/index.ts": "",
    "packages/core/src/index.ts": "",
    "packages/core/src/deep/index.ts": "",
  };

  it("counts an index at a package root", () => {
    expect(entry(files, "packages/core/index.ts")).toBe(true);
  });

  it("counts an index at a package src directory", () => {
    expect(entry(files, "packages/core/src/index.ts")).toBe(true);
  });

  it("does not count an index deeper in the tree", () => {
    expect(entry(files, "packages/core/src/deep/index.ts")).toBe(false);
  });
});

describe("convention rules", () => {
  it.each([
    "app/dashboard/page.tsx",
    "app/layout.tsx",
    "app/api/users/route.ts",
    "app/loading.tsx",
    "app/error.tsx",
    "app/not-found.tsx",
    "app/blog/template.tsx",
    "app/@modal/default.tsx",
    "src/middleware.ts",
    "proxy.ts",
    "instrumentation.ts",
  ])("counts %s as a framework entry", (path) => {
    expect(isEntryPoint(path, "source", emptyEntries)).toBe(true);
  });

  it.each(["scripts/release.ts", "bin/serve.mjs", "packages/a/scripts/seed.ts"])(
    "counts %s as an executed file",
    (path) => {
      expect(isEntryPoint(path, "source", emptyEntries)).toBe(true);
    },
  );

  it("does not count a source file named after a directory rule", () => {
    expect(isEntryPoint("src/scripts.ts", "source", emptyEntries)).toBe(false);
  });

  it.each(["test", "config", "migration", "docs", "asset", "generated", "vendored"] as const)(
    "counts every %s file",
    (role) => {
      expect(isEntryPoint("src/whatever.ts", role, emptyEntries)).toBe(true);
    },
  );

  it("leaves an ordinary source file out", () => {
    expect(isEntryPoint("src/sessions.ts", "source", emptyEntries)).toBe(false);
  });

  it("leaves a script-named file in another language out of the name rules", () => {
    expect(isEntryPoint("app/page.py", "source", emptyEntries)).toBe(false);
  });
});
