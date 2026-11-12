import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";

import { assetPath } from "#src/assets";
import { BoundedOutput, finishOutput } from "#src/sandbox/output";
import {
  SANDBOX_IMAGE,
  type ExecRequest,
  type ExecResult,
  type Sandbox,
  type SandboxConfig,
  type SandboxProvider,
} from "#src/sandbox/sandbox";

interface RunOptions {
  /** Streams stdout and stderr interleaved; the result then carries no output. */
  onOutput?: (chunk: Buffer) => void;
  signal?: AbortSignal;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

export interface DockerProviderOptions {
  docker?: string;
  secrets?: string[];
  runner?: CommandRunner;
}

const HOST_GRACE_MS = 10_000;
const KILLED_EXIT = 137;

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal: options.signal });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const sink = (into: Buffer[]) => (chunk: Buffer) =>
      options.onOutput ? options.onOutput(chunk) : into.push(chunk);
    child.stdout.on("data", sink(stdout));
    child.stderr.on("data", sink(stderr));
    let settled = false;
    const finish = (exitCode: number, extra = "") => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8") + extra,
      });
    };
    child.on("error", (error) => finish(127, error.message));
    child.on("close", (code, signal) => finish(code ?? (signal ? KILLED_EXIT : 1)));
  });

export async function dockerAvailable(docker = "docker", runner: CommandRunner = runCommand): Promise<boolean> {
  const result = await runner(docker, ["info", "--format", "{{.ServerVersion}}"], {
    signal: AbortSignal.timeout(10_000),
  });
  return result.exitCode === 0;
}

export async function buildSandboxImage(docker = "docker", runner: CommandRunner = runCommand): Promise<void> {
  const result = await runner(docker, ["build", "-t", SANDBOX_IMAGE, assetPath("sandbox")]);
  if (result.exitCode !== 0) {
    throw new Error(`docker build failed (${result.exitCode}): ${(result.stderr || result.stdout).slice(-4000)}`);
  }
}

function containerName(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(runId)) throw new Error(`invalid run id for a container name: ${runId}`);
  return `factory-${runId}`;
}

function runArgs(name: string, config: SandboxConfig, hostPath: string, user: string): string[] {
  if (hostPath.includes(",")) throw new Error(`worktree path cannot contain a comma: ${hostPath}`);
  const { limits } = config;
  return [
    "run", "-d",
    "--name", name,
    "--label", `lintcat.factory.run=${config.runId}`,
    "--user", user,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    "--tmpfs", `/tmp:rw,exec,size=${limits.tmpfsMb}m`,
    "--pids-limit", String(limits.pids),
    "--memory", `${limits.memoryMb}m`,
    "--memory-swap", `${limits.memoryMb}m`,
    "--cpus", String(limits.cpus),
    "--network", "bridge",
    "--mount", `type=bind,src=${hostPath},dst=/workspace`,
    "-w", "/workspace",
    config.image,
    "sleep", "infinity",
  ];
}

export function execArgs(name: string, request: ExecRequest): string[] {
  const cwd = path.posix.join("/workspace", request.cwd ?? ".");
  if (cwd !== "/workspace" && !cwd.startsWith("/workspace/")) throw new Error(`cwd escapes /workspace: ${request.cwd}`);
  const seconds = (Math.max(request.timeoutMs, 1) / 1000).toFixed(3);
  return ["exec", "-w", cwd, name, "timeout", "-s", "KILL", seconds, "sh", "-lc", request.command];
}

function hostUser(): string {
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return `${uid}:${gid}`;
}

export function createDockerProvider(options: DockerProviderOptions = {}): SandboxProvider {
  const docker = options.docker ?? "docker";
  const secrets = options.secrets ?? [];
  const run = options.runner ?? runCommand;

  const must = async (args: string[], what: string) => {
    const result = await run(docker, args);
    if (result.exitCode !== 0) throw new Error(`${what} failed (${result.exitCode}): ${result.stderr.trim()}`);
    return result;
  };

  return {
    name: "docker",
    async create(config) {
      const name = containerName(config.runId);
      const hostPath = await realpath(config.worktreePath);
      await run(docker, ["rm", "-f", name]);
      await must(runArgs(name, config, hostPath, hostUser()), "docker run");

      let isolated = false;
      let stopped = false;
      let killedGeneration = 0;

      const makeHome = () => must(["exec", name, "mkdir", "-p", "/tmp/home"], "docker exec mkdir");
      const prepare = async () => {
        if (!stopped) return;
        await must(["start", name], "docker start");
        stopped = false;
        if (isolated) await verifyOffline();
        await makeHome();
      };

      const verifyOffline = async () => {
        const inspect = await must(["inspect", "-f", "{{json .NetworkSettings.Networks}}", name], "docker inspect");
        const networks = JSON.parse(inspect.stdout.trim() || "null") as Record<string, unknown> | null;
        const remaining = Object.keys(networks ?? {});
        if (remaining.length > 0) throw new Error(`sandbox ${name} still on networks: ${remaining.join(", ")}`);
      };

      const hardKill = async () => {
        stopped = true;
        await run(docker, ["kill", name]);
      };

      const runIn = async (request: ExecRequest): Promise<ExecResult> => {
        await prepare();
        const generation = killedGeneration;
        const output = new BoundedOutput();
        const abort = new AbortController();
        let hostTimedOut = false;
        const timer = setTimeout(() => {
          hostTimedOut = true;
          abort.abort();
          void hardKill();
        }, request.timeoutMs + HOST_GRACE_MS);
        const started = Date.now();
        try {
          const result = await run(docker, execArgs(name, request), {
            onOutput: (chunk) => output.push(chunk),
            signal: abort.signal,
          });
          const durationMs = Date.now() - started;
          const killed = killedGeneration !== generation;
          const timedOut =
            hostTimedOut || (!killed && result.exitCode === KILLED_EXIT && durationMs >= request.timeoutMs);
          const exitCode = hostTimedOut || killed ? KILLED_EXIT : result.exitCode;
          if (result.stderr) output.push(Buffer.from(result.stderr));
          return { exitCode, timedOut, durationMs, ...finishOutput(output.text(), secrets) };
        } finally {
          clearTimeout(timer);
        }
      };

      await makeHome();
      const sandbox: Sandbox = {
        id: name,
        setup: runIn,
        async isolate() {
          if (isolated) return;
          await run(docker, ["network", "disconnect", "bridge", name]);
          await verifyOffline();
          isolated = true;
        },
        async exec(request) {
          if (!isolated) throw new Error(`sandbox ${name}: exec before isolate() is refused`);
          return runIn(request);
        },
        async kill() {
          killedGeneration += 1;
          // Killing every process but PID 1 keeps the tmpfs, so setup's caches survive.
          const result = await run(docker, ["exec", name, "sh", "-c", "kill -9 -1"], {
            signal: AbortSignal.timeout(5_000),
          });
          if (result.exitCode !== 0 && !/is not running|No such container/i.test(result.stderr)) await hardKill();
        },
        async destroy() {
          await run(docker, ["rm", "-f", name]);
        },
      };
      return sandbox;
    },
  };
}
