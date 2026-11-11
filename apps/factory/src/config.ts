/** Everything read from outside the process: env, the log file, `claude` and `gh`. */
import { execFile } from "node:child_process";
import { accessSync, appendFileSync, constants, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { StructuredLogger } from "@pr-review/logging";

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

const DEFAULT_DATABASE_URL = "postgres://factory:factory@127.0.0.1:54329/factory";

export interface FactoryConfig {
  databaseUrl: string;
  auth: "subscription" | "api-key";
  claudePath: string | undefined;
  delivery: "branch" | "pr";
}

export function readConfig(env: Record<string, string | undefined>): FactoryConfig {
  const auth = env.FACTORY_AUTH || "subscription";
  if (auth !== "subscription" && auth !== "api-key") {
    throw new EnvironmentError(`FACTORY_AUTH must be subscription or api-key, not ${JSON.stringify(auth)}`);
  }
  const delivery = env.FACTORY_DELIVERY || "branch";
  if (delivery !== "branch" && delivery !== "pr") {
    throw new EnvironmentError(`FACTORY_DELIVERY must be branch or pr, not ${JSON.stringify(delivery)}`);
  }
  return {
    databaseUrl: env.FACTORY_DATABASE_URL || DEFAULT_DATABASE_URL,
    auth,
    claudePath: env.FACTORY_CLAUDE_PATH || undefined,
    delivery,
  };
}

export function findLocalEnvFile(from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, ".env.local");
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

// A bundled SDK cannot find its own cli.js, so an installed `claude` is required.
export function claudeExecutable(config: FactoryConfig, env: Record<string, string | undefined>): string {
  if (config.auth === "api-key" && !env.ANTHROPIC_API_KEY) {
    throw new EnvironmentError("FACTORY_AUTH=api-key needs ANTHROPIC_API_KEY");
  }
  const candidates = config.claudePath
    ? [config.claudePath]
    : (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "claude"));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new EnvironmentError(
    config.claudePath
      ? `FACTORY_CLAUDE_PATH ${config.claudePath} is not executable`
      : "no `claude` on PATH: install Claude Code and log in, or set FACTORY_CLAUDE_PATH",
  );
}

export function fileLogger(file: string): StructuredLogger {
  let ready = false;
  const write = (level: "info" | "error", event: string, fields: Record<string, unknown> = {}) => {
    if (!ready) {
      mkdirSync(path.dirname(file), { recursive: true });
      ready = true;
    }
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), level, event, ...fields })}\n`);
  };
  return { info: (event, fields) => write("info", event, fields), error: (event, fields) => write("error", event, fields) };
}

function gh(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { cwd }, (error, stdout, stderr) => {
      if (error) reject(new Error(`gh ${args[0]} ${args[1]} failed: ${String(stderr).trim() || error.message}`));
      else resolve(String(stdout).trim());
    });
  });
}

export async function openPullRequest(request: {
  repoPath: string;
  branch: string;
  base: string | null;
  title: string;
  body: string;
}): Promise<{ url: string }> {
  const { repoPath, branch } = request;
  const existing = await gh(["pr", "list", "--head", branch, "--json", "url", "--jq", ".[0].url"], repoPath);
  if (existing) return { url: existing };
  const base = request.base ? ["--base", request.base] : [];
  const created = await gh(["pr", "create", "--head", branch, ...base, "--title", request.title, "--body", request.body], repoPath);
  return { url: created.split("\n").pop()!.trim() };
}
