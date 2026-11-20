/** Each command against the factory service; returns the process exit code. */
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { createClaudeRuntime } from "#src/agent/claude-agent-sdk";
import type { AgentRuntime } from "#src/agent/runtime";
import { buildSandboxImage, createDockerProvider, dockerAvailable } from "#src/engine/sandbox/docker-sandbox";
import { createFactoryService, type FactoryService } from "#src/engine/service";
import { detectChecks } from "#src/engine/checks";
import { ensureFactoryExcluded, repoRoot } from "#src/engine/git";
import { migrateFactoryDatabase, openFactoryDatabase } from "#src/engine/store/client";
import { listRuns } from "#src/engine/store/runs";
import { errorMessage } from "@pr-review/logging";
import { runDiscovery } from "#src/engine/discovery";
import { runDir } from "#src/engine/run-files";
import { TOOL_VERSION } from "#src/engine/telemetry";
import type { FactoryRun } from "#src/engine/store/schema";

import {
  claudeExecutable,
  EnvironmentError,
  fileLogger,
  openPullRequest,
  readConfig,
  type FactoryConfig,
} from "#src/config";
import { createTerminalIO } from "#src/discovery-io";
import { USAGE, type Command } from "#src/options";
import {
  formatEvent,
  renderFailedCommand,
  renderResult,
  renderRuns,
  renderStatus,
  renderSummary,
  TERMINAL_STATUSES,
} from "#src/render";
import { prune, report } from "#src/report";

export interface CommandContext {
  env: Record<string, string | undefined>;
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Aborted by the first Ctrl-C or SIGTERM. */
  signal: AbortSignal;
  interrupt: () => void;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
}

type Database = ReturnType<typeof openFactoryDatabase>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SECRET_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

// Redacted from sandbox output before it is stored or shown to an agent.
const hostSecrets = (env: CommandContext["env"]) => SECRET_ENV.map((key) => env[key]).filter((v): v is string => !!v && v.length >= 8);

const readOnlyRuntime: AgentRuntime = {
  name: "none",
  run() {
    throw new Error("this command runs no agent");
  },
};

async function resolveRepo(repoPath: string | undefined, cwd: string): Promise<string> {
  try {
    return await repoRoot(path.resolve(cwd, repoPath ?? "."));
  } catch {
    throw new EnvironmentError(`${repoPath ?? cwd} is not inside a git repository`);
  }
}

async function logRepo(cwd: string): Promise<string> {
  return repoRoot(cwd).catch(() => homedir());
}

function describeDbError(error: unknown, config: FactoryConfig): EnvironmentError {
  const cause = (error as { cause?: unknown }).cause;
  const reason = cause === undefined ? errorMessage(error) : errorMessage(cause) || String((cause as { code?: unknown }).code ?? "");
  if (/does not exist|42P01/.test(reason)) return new EnvironmentError("the factory database is not migrated: run `factory init`");
  const where = config.databaseUrl.replace(/\/\/[^@]*@/, "//");
  return new EnvironmentError(
    `cannot reach the factory database at ${where} (${reason}); start it with docker compose -f apps/factory/compose.yaml up -d`,
  );
}

async function openDatabase(config: FactoryConfig): Promise<Database> {
  const db = openFactoryDatabase(config.databaseUrl);
  try {
    await listRuns(db.database, { limit: 1 });
    return db;
  } catch (error) {
    await db.close().catch(() => {});
    throw describeDbError(error, config);
  }
}

async function requireDocker(): Promise<void> {
  if (!(await dockerAvailable())) throw new EnvironmentError("Docker is not running: start Docker Desktop or the docker daemon");
}

interface ServiceOptions {
  db: Database;
  env: CommandContext["env"];
  config: FactoryConfig;
  logRepo: string;
  delivery?: "branch" | "pr";
  runtime?: AgentRuntime;
}

function makeService({ db, env, config, logRepo: repo, delivery, runtime }: ServiceOptions): FactoryService {
  return createFactoryService({
    database: db.database,
    runtime: runtime ?? readOnlyRuntime,
    sandboxes: createDockerProvider({ secrets: hostSecrets(env) }),
    logger: fileLogger(path.join(repo, ".factory", "factory.log")),
    delivery: delivery ?? config.delivery,
    openPullRequest,
  });
}

function agentRuntime(ctx: CommandContext, config: FactoryConfig): AgentRuntime {
  return createClaudeRuntime({ auth: config.auth, executable: claudeExecutable(config, ctx.env) });
}

async function allEvents(service: FactoryService, runId: string) {
  const all = [];
  for (;;) {
    const page = await service.events(runId, all.at(-1)?.id);
    if (page.length === 0) return all;
    all.push(...page);
  }
}

async function explainUnclaimable(ctx: CommandContext, service: FactoryService, runId: string): Promise<number> {
  const run = await service.get(runId);
  if (!run) ctx.err(`no run ${runId}`);
  else if (TERMINAL_STATUSES.includes(run.status)) ctx.err(`${runId} already finished as ${run.status}; see factory result ${runId}`);
  else if (run.status === "awaiting_approval") ctx.err(`${runId} is not approved yet`);
  else if (run.leaseExpiresAt && run.leaseExpiresAt > new Date()) {
    ctx.err(`${runId} is still running elsewhere (lease until ${run.leaseExpiresAt.toISOString()}); follow it with factory logs -f ${runId}`);
  } else ctx.err(`${runId} cannot be claimed right now (${run.status}); try again shortly`);
  return 1;
}

async function foreground(ctx: CommandContext, service: FactoryService, runId: string): Promise<number> {
  let afterId = (await allEvents(service, runId)).at(-1)?.id;
  const pump = async () => {
    for (const event of await service.events(runId, afterId)) {
      ctx.out(formatEvent(event));
      afterId = event.id;
    }
  };
  let running = true;
  const poller = (async () => {
    while (running) {
      await sleep(1_000);
      await pump().catch(() => {});
    }
  })();
  const onAbort = () => {
    void service.cancel(runId).then(() => ctx.err("cancel requested; stopping at the next safe point (Ctrl-C again to quit)"));
  };
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  let done: Awaited<ReturnType<FactoryService["runNext"]>>;
  try {
    done = await service.runNext({ runId });
  } finally {
    running = false;
    ctx.signal.removeEventListener("abort", onAbort);
    await poller;
    await pump().catch(() => {});
  }
  if (!done) return explainUnclaimable(ctx, service, runId);
  const run = await service.get(runId);
  ctx.out(`\n${runId} ${done.status}${run?.outcome?.summary ? `: ${run.outcome.summary}` : ""}`);
  if (run?.outcome?.pullRequestUrl) ctx.out(`PR: ${run.outcome.pullRequestUrl}`);
  if (run?.blocker) ctx.out(`Blocker: ${run.blocker}`);
  ctx.out(`Details: factory result ${runId}`);
  return done.status === "delivered" ? 0 : 1;
}

async function init(ctx: CommandContext, repoPath: string | undefined): Promise<number> {
  const config = readConfig(ctx.env);
  const repo = await resolveRepo(repoPath, ctx.cwd);
  await requireDocker();
  ctx.out("✓ Docker is running");
  ctx.out("… building the sandbox image");
  try {
    await buildSandboxImage();
  } catch (error) {
    throw new EnvironmentError(errorMessage(error));
  }
  ctx.out("✓ sandbox image built");
  await ensureFactoryExcluded(repo);
  ctx.out(`✓ .factory/ is git-ignored in ${repo}`);
  const plan = await detectChecks(repo);
  if (plan.checks.length === 0) {
    ctx.out("! no checks detected: add .factory/checks with `name: command` lines (e.g. `test: pnpm test`)");
  } else {
    ctx.out(`✓ checks (${plan.source}):`);
    if (plan.install) ctx.out(`    install: ${plan.install}`);
    for (const check of plan.checks) ctx.out(`    ${check.name}: ${check.command}`);
  }
  try {
    claudeExecutable(config, ctx.env);
    ctx.out(`✓ claude found (auth: ${config.auth})`);
  } catch (error) {
    ctx.out(`! ${errorMessage(error)}`);
  }
  const db = openFactoryDatabase(config.databaseUrl);
  try {
    await migrateFactoryDatabase(db.database);
  } catch (error) {
    throw describeDbError(error, config);
  } finally {
    await db.close().catch(() => {});
  }
  ctx.out("✓ database reachable and migrated");
  return 0;
}

async function discover(ctx: CommandContext, command: Extract<Command, { kind: "new" }>): Promise<number> {
  const config = readConfig(ctx.env);
  const repo = await resolveRepo(command.repoPath, ctx.cwd);
  const delivery = command.pr ? "pr" : config.delivery;
  const runtime = agentRuntime(ctx, config);
  if (command.run) await requireDocker();
  const db = await openDatabase(config);
  const service = makeService({ db, env: ctx.env, config, logRepo: repo, delivery, runtime });
  const rl = createInterface({ input: ctx.stdin, output: ctx.stdout });
  rl.on("SIGINT", ctx.interrupt);
  const io = createTerminalIO({
    service,
    repoPath: repo,
    profile: command.profile,
    allowPullRequest: delivery === "pr",
    ask: (prompt) => rl.question(prompt, { signal: ctx.signal }),
    out: ctx.out,
    progress: (text) => ctx.err(`  … ${text}`),
  });
  const discard = async () => {
    const runId = io.runId();
    if (runId) await service.cancel(runId).catch(() => {});
  };
  try {
    let result: Awaited<ReturnType<typeof runDiscovery>>;
    try {
      result = await runDiscovery({ runtime, repoPath: repo, outcome: command.outcome, io, signal: ctx.signal });
    } catch (error) {
      await discard();
      if (ctx.signal.aborted) {
        ctx.err("\nDiscovery aborted.");
        return 1;
      }
      throw error;
    } finally {
      rl.close();
    }
    if (result.status === "aborted") {
      await discard();
      ctx.out("Discarded.");
      return 1;
    }
    const runId = io.runId()!;
    if (!command.run) {
      ctx.out(`Queued ${runId}. Run it with: factory run ${runId} (or a factory worker)`);
      return 0;
    }
    ctx.out(`Running ${runId}… (Ctrl-C cancels)`);
    return await foreground(ctx, service, runId);
  } finally {
    await db.close();
  }
}

async function runOne(ctx: CommandContext, runId: string): Promise<number> {
  const config = readConfig(ctx.env);
  const db = await openDatabase(config);
  try {
    const run = await makeService({ db, env: ctx.env, config, logRepo: await logRepo(ctx.cwd) }).get(runId);
    if (!run) {
      ctx.err(`no run ${runId}`);
      return 1;
    }
    const runtime = agentRuntime(ctx, config);
    await requireDocker();
    const delivery = run.contract.permittedOperations.openPullRequest ? "pr" : config.delivery;
    return await foreground(ctx, makeService({ db, env: ctx.env, config, logRepo: run.repoPath, delivery, runtime }), runId);
  } finally {
    await db.close();
  }
}

async function worker(ctx: CommandContext, pollMs: number): Promise<number> {
  const config = readConfig(ctx.env);
  const runtime = agentRuntime(ctx, config);
  await requireDocker();
  const db = await openDatabase(config);
  try {
    const service = makeService({ db, env: ctx.env, config, logRepo: await logRepo(ctx.cwd), runtime });
    ctx.out(`factory worker polling every ${pollMs}ms (delivery: ${config.delivery}); Ctrl-C stops after the current run`);
    await service.worker({ signal: ctx.signal, pollMs, onRun: (r) => ctx.out(`${new Date().toISOString()} ${r.runId} ${r.status}`) });
    return 0;
  } finally {
    await db.close();
  }
}

async function withService<T>(ctx: CommandContext, work: (service: FactoryService) => Promise<T>): Promise<T> {
  const config = readConfig(ctx.env);
  const db = await openDatabase(config);
  try {
    return await work(makeService({ db, env: ctx.env, config, logRepo: await logRepo(ctx.cwd) }));
  } finally {
    await db.close();
  }
}

async function getOrReport(ctx: CommandContext, service: FactoryService, runId: string): Promise<FactoryRun | undefined> {
  const run = await service.get(runId);
  if (!run) ctx.err(`no run ${runId}`);
  return run;
}

async function status(ctx: CommandContext, runId: string | undefined): Promise<number> {
  return withService(ctx, async (service) => {
    if (!runId) {
      ctx.out(renderRuns(await service.list({ limit: 20 })));
      const summary = renderSummary(await service.summary());
      if (summary) ctx.out(`\n${summary}`);
      return 0;
    }
    const run = await getOrReport(ctx, service, runId);
    if (!run) return 1;
    ctx.out(renderStatus(run));
    const events = (await allEvents(service, runId)).slice(-10);
    if (events.length) ctx.out(`\n${events.map(formatEvent).join("\n")}`);
    return 0;
  });
}

async function logs(ctx: CommandContext, runId: string, follow: boolean): Promise<number> {
  return withService(ctx, async (service) => {
    if (!(await getOrReport(ctx, service, runId))) return 1;
    let afterId: number | undefined;
    for (;;) {
      for (const event of await service.events(runId, afterId)) {
        ctx.out(formatEvent(event));
        afterId = event.id;
      }
      const run = await service.get(runId);
      if (!follow || !run || TERMINAL_STATUSES.includes(run.status) || ctx.signal.aborted) break;
      await sleep(1_000);
    }
    for (const command of (await service.commands(runId)).filter((c) => c.exitCode !== 0 || c.timedOut)) {
      ctx.out(`\n${renderFailedCommand(command)}`);
    }
    return 0;
  });
}

async function cancel(ctx: CommandContext, runId: string): Promise<number> {
  return withService(ctx, async (service) => {
    const outcome = await service.cancel(runId);
    const text = {
      cancelled: `${runId} cancelled`,
      requested: `cancel requested; ${runId} stops at its next safe point`,
      finished: `${runId} already finished`,
      missing: `no run ${runId}`,
    }[outcome];
    if (outcome === "missing") ctx.err(text);
    else ctx.out(text);
    return outcome === "missing" ? 1 : 0;
  });
}

async function result(ctx: CommandContext, runId: string): Promise<number> {
  return withService(ctx, async (service) => {
    const run = await getOrReport(ctx, service, runId);
    if (!run) return 1;
    ctx.out(renderResult(run, path.join(runDir(run.repoPath, run.id), "task.md")));
    const task = await service.readTask(run);
    if (task) ctx.out(`\n${task}`);
    return run.status === "delivered" ? 0 : 1;
  });
}

export function runCommand(ctx: CommandContext, command: Command): Promise<number> {
  switch (command.kind) {
    case "help":
      ctx.out(USAGE);
      return Promise.resolve(0);
    case "version":
      ctx.out(TOOL_VERSION);
      return Promise.resolve(0);
    case "init":
      return init(ctx, command.repoPath);
    case "new":
      return discover(ctx, command);
    case "run":
      return runOne(ctx, command.runId);
    case "worker":
      return worker(ctx, command.pollMs);
    case "status":
      return status(ctx, command.runId);
    case "logs":
      return logs(ctx, command.runId, command.follow);
    case "cancel":
      return cancel(ctx, command.runId);
    case "result":
      return result(ctx, command.runId);
    case "report":
      return report(ctx, command, { openDatabase });
    case "prune":
      return prune(ctx, command, { openDatabase });
  }
}
