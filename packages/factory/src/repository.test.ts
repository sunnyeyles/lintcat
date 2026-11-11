import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Spec } from "#src/contract";
import { locate } from "#src/locate";
import { analyseRepository, indexAtHead, isTestPath, renderArchitecture } from "#src/repository";
import { sampleSpec } from "#src/test-fixtures";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function write(repo: string, file: string, content: string) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
}

function fixtureRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "factory-index-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  write(repo, "package.json", JSON.stringify({ name: "fixture", type: "module" }));
  write(repo, "src/release.ts", "export const readVersion = () => '1.0.0';\n");
  write(repo, "src/release.test.ts", "import { readVersion } from './release';\nreadVersion();\n");
  write(repo, "src/cli.ts", "import { readVersion } from './release';\nexport const main = () => readVersion();\n");
  write(repo, "src/boot.ts", "import * as r from './release';\nexport const b = r;\n");
  write(repo, "src/unrelated.ts", "export const other = 1;\n");
  write(repo, "README.md", "readVersion prints the version\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  return repo;
}

const spec: Spec = { ...sampleSpec, title: "Show the version", requirements: ["--version prints readVersion"], plan: ["Reuse readVersion in src/cli.ts"] };

describe("analyseRepository", () => {
  it("ranks existing modules, their importers and their tests from the import graph", async () => {
    const repo = fixtureRepo();
    const brief = await analyseRepository(repo, await locate(repo, spec));

    expect(brief.candidates.map((c) => c.path)).toEqual(expect.arrayContaining(["src/cli.ts", "src/release.ts"]));
    expect(brief.candidates.map((c) => c.path)).not.toContain("README.md");
    const version = brief.candidates.find((c) => c.path === "src/release.ts")!;
    expect(version).toMatchObject({ importers: 3, test: "src/release.test.ts", package: "fixture" });
    expect(brief.impact.direct).toContain("src/boot.ts");
    expect(brief.placement).toMatch(/^Extend src\/cli\.ts/);
    expect(brief.tests).toEqual(expect.arrayContaining(["src/release.ts: extend src/release.test.ts", "src/cli.ts: no paired test, add one beside it"]));
    expect(brief.risks.some((r) => r.startsWith("src/release.ts has"))).toBe(true);

    const markdown = renderArchitecture(brief);
    for (const heading of ["Candidate modules to reuse", "File-level impact", "Recommended placement", "Test implications"]) {
      expect(markdown).toContain(heading);
    }
  });

  it("caches the index per HEAD and rebuilds after a commit", async () => {
    const repo = fixtureRepo();
    const first = await indexAtHead(repo);
    expect(await indexAtHead(repo)).toBe(first);
    write(repo, "src/new.ts", "export const n = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "more");
    const second = await indexAtHead(repo);
    expect(second).not.toBe(first);
    expect(second.files.has("src/new.ts")).toBe(true);
  });
});

describe("isTestPath", () => {
  it.each([
    ["src/a.test.ts", true],
    ["pkg/a_test.go", true],
    ["tests/test_a.py", true],
    ["test/helpers.js", true],
    ["src/__fixtures__/input.json", true],
    ["src/a.ts", false],
    ["package.json", false],
    ["src/testing.ts", false],
  ])("%s → %s", (file, expected) => {
    expect(isTestPath(file)).toBe(expected);
  });
});
