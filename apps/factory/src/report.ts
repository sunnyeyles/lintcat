/** `factory report` and `factory prune`: outcome metrics and retention. */
import path from "node:path";

import { pruneRunHistory } from "#src/engine/store/index";
import { profileMetrics, type ProfileMetrics } from "#src/engine/metrics";
import { repoRoot } from "#src/engine/git";

import type { CommandContext } from "#src/commands";
import { EnvironmentError, readConfig, type FactoryConfig } from "#src/config";

type FactoryDatabaseHandle = { database: Parameters<typeof profileMetrics>[0]; close(): Promise<void> };

export interface ReportDeps {
  openDatabase(config: FactoryConfig): Promise<FactoryDatabaseHandle>;
}

const DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);
const secs = (v: number | null) => (v === null ? "-" : v >= 120_000 ? `${(v / 60_000).toFixed(1)}m` : `${(v / 1000).toFixed(1)}s`);
const usd = (v: number | null) => (v === null ? "-" : `$${v.toFixed(2)}`);

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((row) => row[c]!.length)));
  return rows.map((row) => row.map((cell, c) => cell.padEnd(widths[c]!)).join("  ").trimEnd()).join("\n");
}

export function renderMetrics(metrics: readonly ProfileMetrics[], auth: FactoryConfig["auth"]): string {
  if (metrics.length === 0) return "No finished runs yet.";
  const rows = [
    ["PROFILE", "RUNS", "VERIFIED", "1ST PASS", "MEDIAN", "P95", "CMD FAIL", "REPEATED", "REPAIR OK", "REGRESS", "COST/VERIFIED"],
    ...metrics.map((m) => [
      m.profile,
      String(m.runs),
      pct(m.verifiedDeliveryRate),
      pct(m.firstPassSuccessRate),
      secs(m.wallTimeMs.median),
      secs(m.wallTimeMs.p95),
      pct(m.commandFailureRate),
      pct(m.repeatedFailureRate),
      pct(m.repairSuccessRate),
      pct(m.testRegressionRate),
      `${usd(m.cost.perVerifiedSuccessUsd)}${m.cost.runsWithoutCost ? ` (${m.cost.runsWithoutCost} unknown)` : ""}`,
    ]),
  ];
  const unknown = metrics.flatMap((m) => Object.entries(m.otherEventKinds).map(([kind, n]) => `${m.profile}:${kind}×${n}`));
  return [
    table(rows),
    "",
    `Cost is the runtime's estimate${auth === "subscription" ? "; on a subscription it is notional, not a bill" : ""}. "-" means not measurable from the recorded events.`,
    ...(unknown.length ? [`Events not used by these metrics: ${unknown.join(", ")}`] : []),
  ].join("\n");
}

async function withDatabase<T>(ctx: CommandContext, deps: ReportDeps, work: (db: FactoryDatabaseHandle, config: FactoryConfig) => Promise<T>): Promise<T> {
  const config = readConfig(ctx.env);
  const db = await deps.openDatabase(config);
  try {
    return await work(db, config);
  } catch (error) {
    const cause = (error as { cause?: { code?: unknown } }).cause;
    if (cause?.code === "42P01") throw new EnvironmentError("the factory database is not migrated: run `factory init`");
    throw error;
  } finally {
    await db.close();
  }
}

export async function report(
  ctx: CommandContext,
  command: { json: boolean; repoPath: string | undefined; sinceDays: number | undefined },
  deps: ReportDeps,
): Promise<number> {
  const repoPath = command.repoPath ? await repoRoot(path.resolve(ctx.cwd, command.repoPath)).catch(() => path.resolve(ctx.cwd, command.repoPath!)) : undefined;
  const filter = {
    ...(repoPath ? { repoPath } : {}),
    ...(command.sinceDays ? { since: new Date(Date.now() - command.sinceDays * DAY_MS) } : {}),
  };
  return withDatabase(ctx, deps, async ({ database }, config) => {
    const metrics = await profileMetrics(database, filter);
    if (command.json) {
      ctx.out(JSON.stringify({ filter, costBasis: config.auth === "subscription" ? "notional" : "estimated", metrics }, null, 2));
    } else {
      ctx.out(renderMetrics(metrics, config.auth));
    }
    return 0;
  });
}

export function retentionDays(env: Record<string, string | undefined>, override: number | undefined): number {
  if (override !== undefined) return override;
  const raw = env.FACTORY_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) throw new EnvironmentError(`FACTORY_RETENTION_DAYS must be a whole number of days, not ${JSON.stringify(raw)}`);
  return days;
}

export async function prune(ctx: CommandContext, command: { days: number | undefined }, deps: ReportDeps): Promise<number> {
  const days = retentionDays(ctx.env, command.days);
  return withDatabase(ctx, deps, async ({ database }) => {
    const pruned = await pruneRunHistory(database, new Date(Date.now() - days * DAY_MS));
    ctx.out(`Pruned ${pruned.events} event(s) and ${pruned.commands} command(s) from ${pruned.runs} run(s) finished over ${days} day(s) ago; run rows are kept.`);
    return 0;
  });
}
