import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectChecks } from "#src/checks";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "factory-checks-"));
  dirs.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });

describe("detectChecks", () => {
  it("uses pnpm and the known scripts in order", async () => {
    const root = await repo({
      "package.json": pkg({ build: "tsc", test: "vitest", dev: "x", lint: "eslint ." }),
      "pnpm-lock.yaml": "",
    });
    expect(await detectChecks(root)).toEqual({
      install: "pnpm install --frozen-lockfile",
      checks: [
        { name: "lint", command: "pnpm run lint" },
        { name: "test", command: "pnpm run test" },
        { name: "build", command: "pnpm run build" },
      ],
      source: "detected",
    });
  });

  it("picks the package manager from the lockfile", async () => {
    const npm = await repo({ "package.json": pkg({ test: "jest" }), "package-lock.json": "{}" });
    expect((await detectChecks(npm)).install).toBe("npm ci");
    const yarn = await repo({ "package.json": pkg({ typecheck: "tsc" }), "yarn.lock": "" });
    expect(await detectChecks(yarn)).toMatchObject({
      install: "yarn install --frozen-lockfile",
      checks: [{ name: "typecheck", command: "yarn run typecheck" }],
    });
    const bun = await repo({ "package.json": pkg({}), "bun.lockb": "" });
    expect((await detectChecks(bun)).install).toBe("bun install --frozen-lockfile");
  });

  it("skips npm's placeholder test script", async () => {
    const root = await repo({ "package.json": pkg({ test: 'echo "Error: no test specified" && exit 1' }) });
    expect((await detectChecks(root)).checks).toEqual([]);
  });

  it("detects go, cargo and uv", async () => {
    const go = await repo({ "go.mod": "module x" });
    expect((await detectChecks(go)).checks.map((c) => c.command)).toEqual(["go vet ./...", "go test ./..."]);
    const cargo = await repo({ "Cargo.toml": "" });
    expect((await detectChecks(cargo)).checks.map((c) => c.name)).toEqual(["cargo test"]);
    const uv = await repo({ "uv.lock": "" });
    expect(await detectChecks(uv)).toMatchObject({ install: "uv sync --frozen", checks: [{ name: "pytest" }] });
  });

  it("falls back to make test only when nothing else matched", async () => {
    const make = await repo({ Makefile: "build:\n\tcc x.c\ntest:\n\t./t\n" });
    expect((await detectChecks(make)).checks).toEqual([{ name: "make test", command: "make test" }]);
    const both = await repo({ Makefile: "test:\n\t./t\n", "go.mod": "" });
    expect((await detectChecks(both)).checks.map((c) => c.name)).not.toContain("make test");
    expect(await detectChecks(await repo({}))).toEqual({ install: null, checks: [], source: "detected" });
  });

  it("lets .factory/checks override detection", async () => {
    const root = await repo({
      "package.json": pkg({ test: "vitest" }),
      ".factory/checks": "# ours\n!deps: pnpm install\n!codegen: pnpm gen\n\nunit: pnpm vitest run\nlint: eslint . --max-warnings=0\n",
    });
    expect(await detectChecks(root)).toEqual({
      install: "pnpm install && pnpm gen",
      checks: [
        { name: "unit", command: "pnpm vitest run" },
        { name: "lint", command: "eslint . --max-warnings=0" },
      ],
      source: "file",
    });
  });

  it("rejects a malformed .factory/checks line", async () => {
    const root = await repo({ ".factory/checks": "just a command\n" });
    await expect(detectChecks(root)).rejects.toThrow(/want "name: command"/);
  });
});
