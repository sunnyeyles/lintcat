/** Layer A end to end over an in-memory repository. */
import { describe, expect, it } from "vitest";

import { buildLayerA } from "./build.js";
import type { FileSource } from "./types.js";

const FILES: Record<string, string> = {
  "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
  "package.json": JSON.stringify({ name: "root", private: true }),
  ".github/CODEOWNERS": "*           @org/everyone\npackages/api/**  @org/api\n",
  "packages/api/package.json": JSON.stringify({
    name: "@acme/api",
    main: "src/index.ts",
    dependencies: { "@acme/core": "workspace:*" },
  }),
  "packages/api/src/index.ts": "",
  "packages/api/src/routes.ts": "",
  "packages/api/src/routes.test.ts": "",
  "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
  "packages/core/src/hash.ts": "",
  "packages/core/dist/hash.js": "",
  "node_modules/left-pad/index.js": "",
  "docs/design.md": "",
};

function source(now = "2026-01-01T00:00:00.000Z"): FileSource {
  return {
    sha: `sha-${now}`,
    listPaths: () => Promise.resolve({ paths: Object.keys(FILES).sort(), truncated: false }),
    read: (path: string) => Promise.resolve(FILES[path]),
  };
}

const built = await buildLayerA(source(), new Date("2026-02-03T04:05:06.000Z"));

function file(path: string) {
  return built.files.find((record) => record.path === path);
}

describe("buildLayerA", () => {
  it("stamps the source sha and the build time", () => {
    expect(built.version).toBe(1);
    expect(built.sha).toBe("sha-2026-01-01T00:00:00.000Z");
    expect(built.builtAt).toBe("2026-02-03T04:05:06.000Z");
  });

  it("discovers the workspace packages", () => {
    expect(built.packages.map((record) => record.name)).toEqual([
      "@acme/api",
      "@acme/core",
    ]);
    expect(built.packages[0]?.dependsOn).toEqual(["@acme/core"]);
  });

  it("assigns each file to its innermost package", () => {
    expect(file("packages/api/src/routes.ts")?.package).toBe("@acme/api");
    expect(file("packages/core/src/hash.ts")?.package).toBe("@acme/core");
    expect(file("docs/design.md")?.package).toBeNull();
  });

  it("keeps vendored and generated files, so the counts stay honest", () => {
    expect(file("node_modules/left-pad/index.js")?.role).toBe("vendored");
    expect(file("packages/core/dist/hash.js")?.role).toBe("generated");
    expect(built.coverage.files).toBe(Object.keys(FILES).length);
    expect(built.coverage.truncated).toBe(false);
  });

  it("resolves owners from .github/CODEOWNERS", () => {
    expect(file("packages/api/src/index.ts")?.owners).toEqual(["@org/api"]);
    expect(file("docs/design.md")?.owners).toEqual(["@org/everyone"]);
  });

  it("records test edges and language counts", () => {
    expect(built.tests).toEqual([
      { test: "packages/api/src/routes.test.ts", source: "packages/api/src/routes.ts" },
    ]);
    expect(built.coverage.languages).toEqual({
      javascript: 2,
      json: 3,
      markdown: 1,
      typescript: 4,
      yaml: 1,
    });
    expect(built.coverage.manifests).toEqual(["pnpm-workspace", "package.json"]);
  });

  it("sorts files by path", () => {
    expect(built.files.map((record) => record.path)).toEqual(
      [...built.files.map((record) => record.path)].sort(),
    );
  });
});
