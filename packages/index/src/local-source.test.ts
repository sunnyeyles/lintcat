/** The one test that indexes this repository, over the real file system. */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildLayerA } from "./build.js";
import { createLocalFileSource } from "./local-source.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const index = await buildLayerA(
  createLocalFileSource(repositoryRoot, "HEAD"),
  new Date("2026-02-03T04:05:06.000Z"),
);

describe("createLocalFileSource over this repository", () => {
  it("skips .git and node_modules", () => {
    const paths = index.files.map((file) => file.path);
    expect(paths.some((path) => path.split("/").includes(".git"))).toBe(false);
    expect(paths.some((path) => path.split("/").includes("node_modules"))).toBe(false);
    expect(index.coverage.truncated).toBe(false);
    expect(paths).toContain("pnpm-workspace.yaml");
  });

  it("finds the workspace packages", () => {
    const names = index.packages.map((record) => record.name);
    expect(names).toContain("@pr-review/ai");
    expect(names).toContain("@pr-review/index");
    expect(names).toContain("@pr-review/db");
    expect(index.coverage.manifests).toContain("pnpm-workspace");
  });

  it("classifies this package's own files", () => {
    const own = index.files.find((file) => file.path === "packages/index/src/build.ts");
    expect(own?.package).toBe("@pr-review/index");
    expect(own?.role).toBe("source");
    expect(own?.language).toBe("typescript");
  });

  it("maps the ai package's tests onto their sources", () => {
    const test = index.files.find(
      (file) => file.path === "packages/ai/src/agents/tools.test.ts",
    );
    expect(test?.role).toBe("test");
    expect(index.tests).toContainEqual({
      test: "packages/ai/src/agents/tools.test.ts",
      source: "packages/ai/src/agents/tools.ts",
    });
  });

  it("classifies a drizzle migration", () => {
    const migration = index.files.find(
      (file) => file.path === "packages/db/drizzle/0000_sad_silver_fox.sql",
    );
    expect(migration?.role).toBe("migration");
  });
});
