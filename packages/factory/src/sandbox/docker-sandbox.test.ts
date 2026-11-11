import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDockerProvider, execArgs, type CommandRunner } from "#src/sandbox/docker-sandbox";
import { boundOutput, hashOutput, HEAD_BYTES, TAIL_BYTES } from "#src/sandbox/output";
import { DEFAULT_LIMITS } from "#src/sandbox/sandbox";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function recordingRunner(networks = "{}") {
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args, options) => {
    calls.push(args);
    if (args[0] === "inspect") return { exitCode: 0, stdout: networks, stderr: "" };
    if (args[0] === "exec" && args.includes("timeout")) options?.onOutput?.(Buffer.from("hello token-abcdef\n"));
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { calls, runner };
}

async function create(networks?: string) {
  const worktree = await mkdtemp(path.join(tmpdir(), "factory-docker-"));
  dirs.push(worktree);
  const { calls, runner } = recordingRunner(networks);
  const provider = createDockerProvider({ runner, secrets: ["token-abcdef"] });
  const sandbox = await provider.create({ runId: "r1", worktreePath: worktree, image: "img:1", limits: DEFAULT_LIMITS });
  return { calls, sandbox, worktree };
}

describe("docker provider arguments", () => {
  it("removes a leftover container, then runs a locked-down one", async () => {
    const { calls, worktree } = await create();
    expect(calls[0]).toEqual(["rm", "-f", "factory-r1"]);
    const run = calls[1]!;
    expect(run.slice(0, 4)).toEqual(["run", "-d", "--name", "factory-r1"]);
    for (const flag of ["--read-only", "--cap-drop", "--security-opt", "--pids-limit", "--memory", "--cpus"]) {
      expect(run).toContain(flag);
    }
    expect(run).toContain(`/tmp:rw,exec,size=${DEFAULT_LIMITS.tmpfsMb}m`);
    expect(run).toContain(`type=bind,src=${await realpath(worktree)},dst=/workspace`);
    expect(run).not.toContain("/var/run/docker.sock");
    expect(run.slice(-3)).toEqual(["img:1", "sleep", "infinity"]);
  });

  it("wraps commands in timeout and redacts secrets", async () => {
    const { calls, sandbox } = await create();
    await sandbox.isolate();
    expect(calls).toContainEqual(["network", "disconnect", "bridge", "factory-r1"]);
    const result = await sandbox.exec({ command: "pnpm test", timeoutMs: 1500, cwd: "pkg" });
    expect(calls.at(-1)).toEqual(["exec", "-w", "/workspace/pkg", "factory-r1", "timeout", "-s", "KILL", "1.500", "sh", "-lc", "pnpm test"]);
    expect(result.output).toBe("hello [redacted]\n");
  });

  it("throws when the container is still on a network after isolate", async () => {
    const { sandbox } = await create('{"bridge":{}}');
    await expect(sandbox.isolate()).rejects.toThrow(/still on networks: bridge/);
    await expect(sandbox.exec({ command: "true", timeoutMs: 1000 })).rejects.toThrow(/isolate/);
  });

  it("refuses a cwd outside /workspace", () => {
    expect(() => execArgs("c", { command: "true", timeoutMs: 1000, cwd: "../etc" })).toThrow(/escapes/);
  });
});

describe("output", () => {
  it("keeps head and tail with a truncation marker", () => {
    const text = "a".repeat(HEAD_BYTES) + "b".repeat(1000) + "c".repeat(TAIL_BYTES);
    const bounded = boundOutput(text);
    expect(bounded).toContain("[truncated 1000 bytes]");
    expect(bounded.startsWith("a".repeat(HEAD_BYTES))).toBe(true);
    expect(bounded.endsWith("c".repeat(TAIL_BYTES))).toBe(true);
    expect(boundOutput("short")).toBe("short");
  });

  it("hashes alike outputs that differ only in timings, ids and timestamps", () => {
    expect(hashOutput("2026-01-02T03:04:05.123Z failed in 120ms at 3fa9c0e1b"))
      .toBe(hashOutput("2025-11-12T10:00:00Z failed in 7ms at 77aa01bc9d"));
    expect(hashOutput("failed")).not.toBe(hashOutput("passed"));
  });
});
