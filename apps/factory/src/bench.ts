/** `factory bench run|compare`: the benchmark harness on the real runtime and Docker sandbox. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { AgentRuntime } from "@pr-review/agent-runtime";
import {
  createDockerProvider,
  listFixtures,
  loadBenchConfig,
  loadResults,
  renderComparison,
  resultDirName,
  runBenchmark,
  type BenchResult,
} from "@pr-review/factory";

import type { CommandContext } from "#src/commands";
import { EnvironmentError, fileLogger, readConfig, type FactoryConfig } from "#src/config";
import type { ReportDeps } from "#src/report";

export interface BenchDeps extends ReportDeps {
  agentRuntime(ctx: CommandContext, config: FactoryConfig): AgentRuntime;
  requireDocker(): Promise<void>;
}

/** A config inside `benchmarks/factory/configs/` names its harness; FACTORY_BENCH_DIR overrides. */
function benchDirFor(ctx: CommandContext, configPath: string): string {
  const dir = ctx.env.FACTORY_BENCH_DIR ? path.resolve(ctx.cwd, ctx.env.FACTORY_BENCH_DIR) : path.dirname(path.dirname(configPath));
  if (!existsSync(path.join(dir, "fixtures"))) {
    throw new EnvironmentError(`no fixtures/ in ${dir}: keep configs in benchmarks/factory/configs or set FACTORY_BENCH_DIR`);
  }
  return dir;
}

function line(result: BenchResult): string {
  const verdict = result.verified ? "✓ verified" : result.factoryStatus === "delivered" ? "✗ hidden checks failed" : `✗ ${result.factoryStatus}`;
  const wall = result.wallTimeMs === null ? "" : ` ${(result.wallTimeMs / 1000).toFixed(0)}s`;
  return `${result.fixture.name.padEnd(11)} ${verdict}${wall} run=${result.runId ?? "-"}${result.blocker ? ` (${result.blocker})` : ""}`;
}

export async function benchRun(
  ctx: CommandContext,
  command: { configPath: string; fixtures: string[] | undefined; keep: boolean },
  deps: BenchDeps,
): Promise<number> {
  const configPath = path.resolve(ctx.cwd, command.configPath);
  if (!existsSync(configPath)) throw new EnvironmentError(`no config at ${configPath}`);
  const loaded = loadBenchConfig(configPath);
  const benchDir = benchDirFor(ctx, configPath);
  const known = listFixtures(benchDir);
  const unknown = (command.fixtures ?? []).filter((name) => !known.includes(name));
  if (unknown.length) throw new EnvironmentError(`unknown fixture(s) ${unknown.join(", ")}; have ${known.join(", ")}`);
  const config = readConfig(ctx.env);
  const runtime = deps.agentRuntime(ctx, config);
  await deps.requireDocker();
  const db = await deps.openDatabase(config);
  try {
    ctx.out(`Benchmark ${loaded.config.name}@${loaded.hash.slice(0, 8)} (auth: ${config.auth}); results in ${path.join(benchDir, "results", resultDirName(loaded))}`);
    const results = await runBenchmark(
      { database: db.database, runtime, sandboxes: createDockerProvider(), logger: fileLogger(path.join(benchDir, "results", "bench.log")) },
      {
        benchDir,
        config: loaded,
        keepWorkDirs: command.keep,
        ...(command.fixtures ? { fixtures: command.fixtures } : {}),
        onResult: (result) => ctx.out(line(result)),
      },
    );
    const verified = results.filter((r) => r.verified).length;
    ctx.out(`\n${verified}/${results.length} verified by hidden checks.`);
    return verified === results.length ? 0 : 1;
  } finally {
    await db.close();
  }
}

/** A config file reads its own results directory; anything else must be a results directory. */
function resultsFor(ctx: CommandContext, argument: string): BenchResult[] {
  const target = path.resolve(ctx.cwd, argument);
  if (!existsSync(target)) throw new EnvironmentError(`no config or results directory at ${target}`);
  if (statSync(target).isDirectory()) return loadResults(target);
  const loaded = loadBenchConfig(target);
  return loadResults(path.join(benchDirFor(ctx, target), "results", resultDirName(loaded)));
}

export function benchCompare(ctx: CommandContext, command: { a: string; b: string }): number {
  ctx.out(renderComparison(resultsFor(ctx, command.a), resultsFor(ctx, command.b)));
  return 0;
}
