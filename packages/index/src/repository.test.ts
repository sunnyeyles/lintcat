/** The builder run against this repository, the alias scheme it has to understand. */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildRepositoryIndex, type RepositoryIndex } from "#src/build";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Never walked: not part of the tree, or not this repository's source. */
const SKIPPED = new Set([
  ".claude",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "dist",
  "node_modules",
]);

/** The fixtures are other repositories in miniature, and would skew the rate. */
const FIXTURES = "evals/fixtures/";

function readTree(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) {
        continue;
      }
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(`${directory}/${entry.name}`, path);
        continue;
      }
      if (!entry.isFile() || path.startsWith(FIXTURES)) {
        continue;
      }
      try {
        files.set(path, readFileSync(`${directory}/${entry.name}`, "utf8"));
      } catch {
        continue;
      }
    }
  };
  walk(ROOT, "");
  return files;
}

let cached: RepositoryIndex | undefined;

function repositoryIndex(): RepositoryIndex {
  cached ??= buildRepositoryIndex({ sha: "0".repeat(40), files: readTree() });
  return cached;
}

function unresolvedWith(prefix: string): string[] {
  return repositoryIndex()
    .edges.filter(
      (edge) => edge.specifier.startsWith(prefix) && edge.to === undefined,
    )
    .map((edge) => `${edge.from}:${edge.line} ${edge.specifier}`);
}

describe("this repository", () => {
  it("finds every workspace package pnpm-workspace.yaml claims", () => {
    const names = repositoryIndex().packages.map((entry) => entry.name);

    expect(names).toContain("@pr-review/index");
    expect(names).toContain("@pr-review/ai");
    expect(repositoryIndex().packages).toContainEqual({
      name: "@pr-review/index",
      root: "packages/index",
    });
    expect(names).not.toContain("pr-review-agents");
  });

  it("names the package each file belongs to", () => {
    expect(repositoryIndex().files.get("packages/index/src/build.ts")?.package).toBe(
      "@pr-review/index",
    );
  });

  it("resolves every #src/ importer through the package imports map", () => {
    expect(unresolvedWith("#src/")).toEqual([]);
  });

  it("resolves every @/ importer through the web app's tsconfig paths", () => {
    expect(unresolvedWith("@/")).toEqual([]);
  });

  it("resolves every @pr-review/ importer through the package exports", () => {
    expect(unresolvedWith("@pr-review/")).toEqual([]);
  });

  it("leaves the TypeScript resolution rate at 1", () => {
    const typescript = repositoryIndex().coverage.find(
      (entry) => entry.language === "typescript",
    );

    expect(typescript?.indexed).toBe(true);
    expect(typescript?.resolution?.rate).toBe(1);
    expect(typescript?.resolution?.internal).toBeGreaterThan(400);
  });
});
