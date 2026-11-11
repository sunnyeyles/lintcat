import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFakeRuntime } from "@pr-review/agent-runtime";
import { createSilentLogger } from "@pr-review/logging";
import { beforeAll, describe, expect, it } from "vitest";

import { buildSandboxImage, createDockerProvider, dockerAvailable } from "#src/sandbox/docker-sandbox";
import { createFactoryService } from "#src/service";
import { listCommands } from "#src/store/runs";
import { createTestFactoryDatabase } from "#src/store/test-store";
import { sampleSpec } from "#src/test-fixtures";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)("quick workflow in the real Docker sandbox", { timeout: 600_000 }, () => {
  beforeAll(() => buildSandboxImage(), 600_000);

  it("runs the agent's commands and the checks offline, as a non-root user", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "factory-docker-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.com");
    writeFileSync(path.join(repo, "version.js"), "export const version = () => null;\n");
    writeFileSync(
      path.join(repo, "test.mjs"),
      "import { version } from './version.js';\nif (version() !== '1.0.0') { console.error('bad version', version()); process.exit(1); }\n",
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");
    mkdirSync(path.join(repo, ".factory"));
    writeFileSync(path.join(repo, ".factory", "checks"), "test: node test.mjs\n");

    const probes: string[] = [];
    const runtime = createFakeRuntime([
      async ({ spec, callTool }) => {
        probes.push(await callTool("sandbox_exec", { command: "id -u" }));
        probes.push(await callTool("sandbox_exec", { command: "node -e \"fetch('https://example.com').then(()=>console.log('online'),()=>console.log('offline'))\"" }));
        writeFileSync(path.join(spec.cwd, "version.js"), "export const version = () => '1.0.0';\n");
        probes.push(await callTool("sandbox_exec", { command: "node test.mjs && echo passed" }));
        return { structured: { status: "done", summary: "set version", decisions: [], acceptance: [], blockers: [] } };
      },
    ]);
    const database = await createTestFactoryDatabase();
    const service = createFactoryService({ database, runtime, sandboxes: createDockerProvider(), logger: createSilentLogger() });
    const { run } = await service.propose({ repoPath: repo, spec: sampleSpec, promptVersion: "test" });
    await service.approve(run.id);

    expect((await service.runNext({ runId: run.id }))?.status).toBe("delivered");
    expect(Number(/^exit 0\n(\d+)/.exec(probes[0] ?? "")?.[1])).toBeGreaterThan(0);
    expect(probes[1]).toContain("offline");
    expect(probes[2]).toContain("passed");
    const commands = await listCommands(database, run.id);
    expect(commands.map((c) => [c.name, c.exitCode])).toContainEqual(["test", 0]);
    expect(execFileSync("docker", ["ps", "-a", "--filter", `name=factory-${run.id}`, "-q"], { encoding: "utf8" }).trim()).toBe("");
  });
});
