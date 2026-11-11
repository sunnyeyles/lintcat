/** `factory mcp`: the MCP server over stdio, spawned by the host as the local user; no network listener. */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AgentRuntime } from "@pr-review/agent-runtime";
import { dockerAvailable, type FactoryRun, type FactoryService } from "@pr-review/factory";

import type { CommandContext } from "#src/commands";
import { claudeExecutable, EnvironmentError, readConfig, type FactoryConfig } from "#src/config";
import { createFactoryMcpServer, type LaunchResult } from "#src/mcp-server";

type Database = { close(): Promise<void> };

export interface McpCommandDeps<D extends Database> {
  openDatabase(config: FactoryConfig): Promise<D>;
  makeService(options: { db: D; config: FactoryConfig; logRepo: string; runtime?: AgentRuntime }): FactoryService;
  agentRuntime(ctx: CommandContext, config: FactoryConfig): AgentRuntime;
  logRepo(cwd: string): Promise<string>;
}

/** Resolves `claude` only when a discovery turn needs it, so status tools work without it. */
function lazyRuntime(create: () => AgentRuntime): AgentRuntime {
  let runtime: AgentRuntime | undefined;
  return {
    name: "claude",
    run: (spec) => (runtime ??= create()).run(spec),
  };
}

/** `factory run <id>` in its own process group, so neither a host exit nor its signals reach it. */
export function detachedLauncher(env: Record<string, string | undefined>, argv = process.argv, execArgv = process.execArgv) {
  return async (run: FactoryRun): Promise<LaunchResult> => {
    if (env.FACTORY_MCP_EXECUTION === "worker") return { mode: "worker" };
    const entry = argv[1];
    if (!entry) throw new Error("cannot tell how this factory process was started");
    const log = path.join(run.repoPath, ".factory", "factory.log");
    mkdirSync(path.dirname(log), { recursive: true });
    const fd = openSync(log, "a");
    try {
      const child = spawn(process.execPath, [...execArgv, entry, "run", run.id], {
        cwd: run.repoPath,
        env,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      return { mode: "detached", pid: child.pid, log };
    } finally {
      closeSync(fd);
    }
  };
}

export async function serveMcp<D extends Database>(ctx: CommandContext, deps: McpCommandDeps<D>): Promise<number> {
  const config = readConfig(ctx.env);
  const db = await deps.openDatabase(config);
  try {
    const runtime = lazyRuntime(() => deps.agentRuntime(ctx, config));
    const service = deps.makeService({ db, config, logRepo: await deps.logRepo(ctx.cwd), runtime });
    const server = createFactoryMcpServer({
      service,
      runtime,
      cwd: ctx.cwd,
      launch: detachedLauncher(ctx.env),
      preflight: async () => {
        if (ctx.env.FACTORY_MCP_EXECUTION === "worker") return;
        claudeExecutable(config, ctx.env);
        if (!(await dockerAvailable())) throw new EnvironmentError("Docker is not running: start it, then approve again");
      },
    });
    const transport = new StdioServerTransport(ctx.stdin as NodeJS.ReadStream, ctx.stdout as NodeJS.WriteStream);
    const closed = new Promise<void>((resolve) => {
      transport.onclose = resolve;
      ctx.stdin.once("end", resolve);
      ctx.stdin.once("close", resolve);
      ctx.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    await server.connect(transport);
    await closed;
    await server.close().catch(() => {});
    return 0;
  } finally {
    await db.close();
  }
}
