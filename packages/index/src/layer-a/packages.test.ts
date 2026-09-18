/** Package discovery, one manifest flavour at a time. */
import { describe, expect, it } from "vitest";

import type { FileSource } from "../types.js";
import { discoverPackages, MAX_MANIFEST_READS } from "./packages.js";

function fakeSource(files: Record<string, string>): FileSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    sha: "test-sha",
    reads,
    listPaths: () => Promise.resolve({ paths: Object.keys(files).sort(), truncated: false }),
    read: (path: string) => {
      reads.push(path);
      return Promise.resolve(files[path]);
    },
  };
}

function discover(files: Record<string, string>) {
  const source = fakeSource(files);
  return discoverPackages(source, Object.keys(files).sort());
}

describe("discoverPackages", () => {
  it("expands pnpm workspace globs and links internal dependencies", async () => {
    const result = await discover({
      "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n  - "!packages/ignored"\n',
      "package.json": JSON.stringify({ name: "root", private: true }),
      "packages/a/package.json": JSON.stringify({
        name: "@x/a",
        main: "src/index.js",
        bin: { a: "./bin/a.js" },
        dependencies: { "@x/b": "workspace:*", zod: "^4" },
      }),
      "packages/b/package.json": JSON.stringify({
        name: "@x/b",
        exports: { ".": "./src/index.ts" },
      }),
      "packages/ignored/package.json": JSON.stringify({ name: "@x/ignored" }),
      "node_modules/zod/package.json": JSON.stringify({ name: "zod" }),
      "packages/a/src/index.js": "",
    });

    expect(result.packages).toEqual([
      {
        name: "@x/a",
        root: "packages/a",
        entryPoints: ["packages/a/src/index.js", "packages/a/bin/a.js"],
        dependsOn: ["@x/b"],
      },
      {
        name: "@x/b",
        root: "packages/b",
        entryPoints: ["packages/b/src/index.ts"],
        dependsOn: [],
      },
    ]);
    expect(result.manifests).toEqual(["pnpm-workspace", "package.json"]);
  });

  it("reads npm workspaces from the root manifest", async () => {
    const result = await discover({
      "package.json": JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
      "apps/web/package.json": JSON.stringify({ name: "web", module: "./index.mjs" }),
    });

    expect(result.packages).toEqual([
      { name: "web", root: "apps/web", entryPoints: ["apps/web/index.mjs"], dependsOn: [] },
    ]);
  });

  it("treats a lone root manifest as the only package", async () => {
    const result = await discover({
      "package.json": JSON.stringify({ name: "solo", main: "index.js" }),
      "index.js": "",
    });

    expect(result.packages).toEqual([
      { name: "solo", root: "", entryPoints: ["index.js"], dependsOn: [] },
    ]);
    expect(result.manifests).toEqual(["package.json"]);
  });

  it("finds no packages in a repository without manifests", async () => {
    const result = await discover({ "src/main.rb": "", "README.md": "" });
    expect(result.packages).toEqual([]);
    expect(result.manifests).toEqual([]);
  });

  it("names a go module by its module path", async () => {
    const result = await discover({
      "go.mod": "module github.com/acme/service\n\ngo 1.23\n",
      "main.go": "",
    });

    expect(result.packages).toEqual([
      { name: "github.com/acme/service", root: "", entryPoints: [], dependsOn: [] },
    ]);
    expect(result.manifests).toEqual(["go.mod"]);
  });

  it("follows go.work use directives", async () => {
    const result = await discover({
      "go.work": "go 1.23\n\nuse (\n\t./api\n\t./worker\n)\n",
      "api/go.mod": "module github.com/acme/api\n",
      "worker/go.mod": "module github.com/acme/worker\n",
      "ignored/go.mod": "module github.com/acme/ignored\n",
    });

    expect(result.packages.map((record) => record.name)).toEqual([
      "github.com/acme/api",
      "github.com/acme/worker",
    ]);
    expect(result.manifests).toEqual(["go.mod", "go.work"]);
  });

  it("reads a name from either pyproject table", async () => {
    const result = await discover({
      "services/api/pyproject.toml": '[project]\nname = "api"\nversion = "0.1.0"\n',
      "services/etl/pyproject.toml": '[tool.poetry]\nname = "etl"\n',
    });

    expect(result.packages.map((record) => [record.name, record.root])).toEqual([
      ["api", "services/api"],
      ["etl", "services/etl"],
    ]);
    expect(result.manifests).toEqual(["pyproject"]);
  });

  it("expands cargo workspace members and skips the virtual root", async () => {
    const result = await discover({
      "Cargo.toml": '[workspace]\nmembers = [\n  "crates/*",\n]\n',
      "crates/engine/Cargo.toml": '[package]\nname = "engine"\nedition = "2021"\n',
      "crates/cli/Cargo.toml": '[package]\nname = "cli"\n',
    });

    expect(result.packages.map((record) => record.name)).toEqual(["cli", "engine"]);
    expect(result.manifests).toEqual(["cargo"]);
  });

  it("stops reading manifests at the cap", async () => {
    const files: Record<string, string> = {
      "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    };
    for (let index = 0; index < 400; index += 1) {
      files[`packages/p${index}/package.json`] = JSON.stringify({ name: `p${index}` });
    }
    const source = fakeSource(files);
    const result = await discoverPackages(source, Object.keys(files).sort());

    expect(source.reads.length).toBe(MAX_MANIFEST_READS);
    expect(result.packages.length).toBeLessThan(400);
  });
});
