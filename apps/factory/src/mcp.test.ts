import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FactoryRun } from "@pr-review/factory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detachedLauncher } from "#src/mcp";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "factory-launch-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("detachedLauncher", () => {
  it("starts `factory run <id>` in the repo, detached, logging to .factory/factory.log", async () => {
    const entry = path.join(dir, "entry.mjs");
    writeFileSync(entry, "console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\n");
    const run = { id: "r1", repoPath: dir } as FactoryRun;
    const launched = await detachedLauncher({ PATH: process.env.PATH }, ["node", entry], [])(run);
    const log = path.join(dir, ".factory", "factory.log");
    expect(launched).toMatchObject({ mode: "detached", log });
    expect(launched.mode === "detached" && launched.pid).toBeGreaterThan(0);
    await eventually(() => existsSync(log) && readFileSync(log, "utf8").includes("argv"));
    const line = JSON.parse(readFileSync(log, "utf8").trim()) as { argv: string[]; cwd: string };
    expect(line.argv).toEqual(["run", "r1"]);
    expect(path.basename(line.cwd)).toBe(path.basename(dir));
  });

  it("leaves the run to a worker when FACTORY_MCP_EXECUTION=worker", async () => {
    const run = { id: "r1", repoPath: dir } as FactoryRun;
    expect(await detachedLauncher({ FACTORY_MCP_EXECUTION: "worker" }, ["node", "unused"], [])(run)).toEqual({ mode: "worker" });
    expect(existsSync(path.join(dir, ".factory"))).toBe(false);
  });
});
