import { spawnSync } from "node:child_process";
import path from "node:path";

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

// Nothing this tool runs needs a secret, so none reaches a child process.
function scrubbedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/(_API_KEY|_TOKEN|_SECRET|DATABASE_URL)$/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export function run(command: string, args: string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...scrubbedEnv(), ...options.env },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeoutMs ?? 10 * 60_000,
  });
  if (result.error) {
    return { status: null, stdout: result.stdout ?? "", stderr: `${result.stderr ?? ""}${result.error.message}` };
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// The workspace's own binaries, so metrics never depend on pnpm being usable.
export function bin(root: string, tool: string): string {
  return path.join(root, "node_modules", ".bin", tool);
}

export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
