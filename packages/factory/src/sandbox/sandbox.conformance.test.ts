import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSandboxImage, createDockerProvider, dockerAvailable, runCommand } from "#src/sandbox/docker-sandbox";
import { createFakeSandboxProvider, type FakeHandler } from "#src/sandbox/fake-sandbox";
import { DEFAULT_LIMITS, SANDBOX_IMAGE, type Sandbox, type SandboxProvider } from "#src/sandbox/sandbox";

const SECRET = "sk-test-0123456789";

// Interprets just enough shell for the shared contract.
const shellish: FakeHandler = async ({ command }) => {
  const sleep = /^sleep (\d+)$/.exec(command);
  if (sleep) await new Promise((resolve) => setTimeout(resolve, Number(sleep[1]) * 1000).unref());
  const exit = /^exit (\d+)$/.exec(command);
  const echo = /^echo (.*)$/.exec(command);
  return { exitCode: exit ? Number(exit[1]) : 0, output: echo ? `${echo[1]}\n` : "" };
};

function contract(name: string, makeProvider: () => SandboxProvider, timeout: number) {
  describe(`${name} sandbox contract`, { timeout }, () => {
    let worktree: string;
    let sandbox: Sandbox;

    beforeAll(async () => {
      worktree = await mkdtemp(path.join(tmpdir(), "factory-sandbox-"));
      sandbox = await makeProvider().create({
        runId: `conformance-${name}-${process.pid}`,
        worktreePath: worktree,
        image: SANDBOX_IMAGE,
        limits: { ...DEFAULT_LIMITS, memoryMb: 512, pids: 256, tmpfsMb: 64 },
      });
    });

    afterAll(async () => {
      await sandbox?.destroy();
      await rm(worktree, { recursive: true, force: true });
    });

    it("refuses exec before isolate", async () => {
      await expect(sandbox.exec({ command: "true", timeoutMs: 5000 })).rejects.toThrow(/isolate/);
    });

    it("runs setup before isolation", async () => {
      expect((await sandbox.setup({ command: "true", timeoutMs: 10_000 })).exitCode).toBe(0);
    });

    it("isolates idempotently and then executes", async () => {
      await sandbox.isolate();
      await sandbox.isolate();
      const result = await sandbox.exec({ command: "exit 3", timeoutMs: 10_000 });
      expect(result).toMatchObject({ exitCode: 3, timedOut: false });
      expect(result.outputHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("redacts secrets from output", async () => {
      const result = await sandbox.exec({ command: `echo ${SECRET}`, timeoutMs: 10_000 });
      expect(result.output).not.toContain(SECRET);
      expect(result.output).toContain("[redacted]");
    });

    it("times out a stuck command quickly", async () => {
      const result = await sandbox.exec({ command: "sleep 30", timeoutMs: 2000 });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.durationMs).toBeLessThan(8000);
    });

    it("kill ends an in-flight exec with 137 and the sandbox stays usable", async () => {
      const running = sandbox.exec({ command: "sleep 30", timeoutMs: 60_000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await sandbox.kill();
      expect(await running).toMatchObject({ exitCode: 137, timedOut: false });
      expect((await sandbox.exec({ command: "exit 0", timeoutMs: 10_000 })).exitCode).toBe(0);
    });
  });
}

contract("fake", () => createFakeSandboxProvider(shellish, { secrets: [SECRET] }), 15_000);

const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)("docker sandbox", { timeout: 600_000 }, () => {
  beforeAll(() => buildSandboxImage(), 600_000);

  contract("docker", () => createDockerProvider({ secrets: [SECRET] }), 60_000);

  describe("isolation properties", { timeout: 60_000 }, () => {
    let worktree: string;
    let sandbox: Sandbox;
    const run = (command: string) => sandbox.exec({ command, timeoutMs: 20_000 });

    beforeAll(async () => {
      worktree = await mkdtemp(path.join(tmpdir(), "factory-sandbox-"));
      sandbox = await createDockerProvider().create({
        runId: `isolation-${process.pid}`,
        worktreePath: worktree,
        image: SANDBOX_IMAGE,
        limits: { ...DEFAULT_LIMITS, memoryMb: 512, pids: 256, tmpfsMb: 64 },
      });
      expect((await sandbox.setup({ command: "getent hosts example.com", timeoutMs: 20_000 })).exitCode).toBe(0);
      await sandbox.isolate();
    }, 60_000);

    afterAll(async () => {
      await sandbox?.destroy();
      await rm(worktree, { recursive: true, force: true });
    });

    it("has no network after isolate", async () => {
      expect((await run("getent hosts example.com")).exitCode).not.toBe(0);
      const fetched = await run(`node -e 'fetch("https://example.com").then(() => process.exit(0), () => process.exit(9))'`);
      expect(fetched.exitCode).toBe(9);
    });

    it("runs as a non-root user with no capabilities", async () => {
      expect((await run("id -u")).output.trim()).not.toBe("0");
      expect((await run("grep CapEff /proc/self/status")).output).toMatch(/CapEff:\s+0{16}/);
    });

    it("has a read-only root but writable /workspace and /tmp", async () => {
      expect((await run("touch /rootfile")).exitCode).not.toBe(0);
      expect((await run("echo hi > /workspace/out.txt && echo t > /tmp/t && mkdir -p $HOME/x")).exitCode).toBe(0);
      expect(await readFile(path.join(worktree, "out.txt"), "utf8")).toBe("hi\n");
    });

    it("applies the memory limit", async () => {
      expect((await run("cat /sys/fs/cgroup/memory.max")).output.trim()).toBe(String(512 * 1024 * 1024));
    });

    it("removes the container on destroy", async () => {
      const name = sandbox.id;
      await sandbox.destroy();
      expect((await runCommand("docker", ["inspect", name])).exitCode).not.toBe(0);
    });
  });
});
