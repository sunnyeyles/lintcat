/** Per-profile outcome metrics, read-only over the run, event and command tables. */
import { and, asc, gte, inArray, isNotNull, type SQL, eq } from "drizzle-orm";

import type { FactoryDatabase } from "#src/store/client";
import { factoryCommands, factoryEvents, factoryRuns, type FactoryRun } from "#src/store/schema";

const TERMINAL = ["delivered", "failed", "cancelled"] as const;

export interface HistoryFilter {
  repoPath?: string;
  since?: Date;
}

interface HistoryEvent {
  runId: string;
  kind: string;
  stage: string | null;
  at: Date;
  data: Record<string, unknown>;
}

interface HistoryCommand {
  runId: string;
  stage: string;
  name: string;
  exitCode: number;
  timedOut: boolean;
  errorCategory: string | null;
  output: string;
  startedAt: Date;
}

type HistoryRun = Pick<
  FactoryRun,
  "id" | "repoPath" | "status" | "profile" | "workflowVersion" | "createdAt" | "finishedAt" | "blocker" | "outcome"
>;

export interface RunHistory {
  runs: HistoryRun[];
  eventsByRun: Map<string, HistoryEvent[]>;
  commandsByRun: Map<string, HistoryCommand[]>;
}

function group<T extends { runId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(row.runId, [...(map.get(row.runId) ?? []), row]);
  return map;
}

/** Terminal runs that reached a profile, with their events and commands. */
export async function loadRunHistory(database: FactoryDatabase, filter: HistoryFilter = {}): Promise<RunHistory> {
  const conditions: SQL[] = [inArray(factoryRuns.status, [...TERMINAL]), isNotNull(factoryRuns.profile)];
  if (filter.repoPath) conditions.push(eq(factoryRuns.repoPath, filter.repoPath));
  if (filter.since) conditions.push(gte(factoryRuns.createdAt, filter.since));
  const runs = await database
    .select({
      id: factoryRuns.id,
      repoPath: factoryRuns.repoPath,
      status: factoryRuns.status,
      profile: factoryRuns.profile,
      workflowVersion: factoryRuns.workflowVersion,
      createdAt: factoryRuns.createdAt,
      finishedAt: factoryRuns.finishedAt,
      blocker: factoryRuns.blocker,
      outcome: factoryRuns.outcome,
    })
    .from(factoryRuns)
    .where(and(...conditions))
    .orderBy(asc(factoryRuns.createdAt), asc(factoryRuns.id));
  const ids = runs.map((r) => r.id);
  if (ids.length === 0) return { runs, eventsByRun: new Map(), commandsByRun: new Map() };
  const events = await database
    .select({ runId: factoryEvents.runId, kind: factoryEvents.kind, stage: factoryEvents.stage, at: factoryEvents.at, data: factoryEvents.data })
    .from(factoryEvents)
    .where(inArray(factoryEvents.runId, ids))
    .orderBy(asc(factoryEvents.id));
  const commands = await database
    .select({
      runId: factoryCommands.runId,
      stage: factoryCommands.stage,
      name: factoryCommands.name,
      exitCode: factoryCommands.exitCode,
      timedOut: factoryCommands.timedOut,
      errorCategory: factoryCommands.errorCategory,
      output: factoryCommands.output,
      startedAt: factoryCommands.startedAt,
    })
    .from(factoryCommands)
    .where(inArray(factoryCommands.runId, ids))
    .orderBy(asc(factoryCommands.id));
  return { runs, eventsByRun: group(events), commandsByRun: group(commands) };
}

export interface ProfileMetrics {
  profile: string;
  runs: number;
  delivered: number;
  failed: number;
  cancelled: number;
  verifiedDeliveryRate: number | null;
  firstPassSuccessRate: number | null;
  wallTimeMs: { median: number | null; p95: number | null };
  commands: number;
  commandFailureRate: number | null;
  repeatedFailureRate: number | null;
  repairSuccessRate: number | null;
  testRegressionRate: number | null;
  escalationRate: number | null;
  agentRunsPerRun: number | null;
  cost: { estimatedUsd: number | null; perVerifiedSuccessUsd: number | null; runsWithoutCost: number };
  otherEventKinds: Record<string, number>;
}

/** Event kinds the metrics read; anything else is counted, never an error. */
const KNOWN_KINDS = new Set([
  "spec_proposed",
  "approved",
  "run_started",
  "recovery_started",
  "worktree_reconciled",
  "setup_paths_excluded",
  "sandbox_ready",
  "agent_auth",
  "agent_finished",
  "checks_finished",
  "repair_started",
  "repeated_failure",
  "run_delivered",
  "run_failed",
  "run_cancelled",
  "task_md_conflict",
  "baseline_recorded",
  "bug_reproduced",
  "reproduce_rejected",
  "profile_escalated",
  "review_finished",
  "review_repair_started",
]);

// A failing check while reproducing a bug is the point of that stage, not a failure.
export const EXPECTED_FAILURE_STAGES = new Set(["reproduce"]);

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);

/** Nearest-rank percentile, so every value reported is one that was observed. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

interface CheckResult {
  name: string;
  passed: boolean;
}

function checkResults(data: Record<string, unknown>): CheckResult[] {
  const results = Array.isArray(data.results) ? data.results : [];
  return results.flatMap((entry): CheckResult[] => {
    if (!entry || typeof entry !== "object") return [];
    const { name, exitCode, passed } = entry as { name?: unknown; exitCode?: unknown; passed?: unknown };
    if (typeof name !== "string") return [];
    if (typeof passed === "boolean") return [{ name, passed }];
    return typeof exitCode === "number" ? [{ name, passed: exitCode === 0 }] : [];
  });
}

/** Wall time runs from the first claim to the finish, so waiting for approval doesn't count. */
function wallTime(run: HistoryRun, events: readonly HistoryEvent[]): number | null {
  if (!run.finishedAt) return null;
  const start = events.find((e) => e.kind === "run_started")?.at;
  return start ? run.finishedAt.getTime() - start.getTime() : null;
}

function runCost(run: HistoryRun): number | null {
  const cost = run.outcome?.usage?.estimatedCostUsd;
  return typeof cost === "number" ? cost : null;
}

function regressed(events: readonly HistoryEvent[]): boolean | null {
  const baseline = events.filter((e) => e.kind.startsWith("baseline")).flatMap((e) => checkResults(e.data));
  if (baseline.length === 0) return null;
  const passing = new Set(baseline.filter((c) => c.passed).map((c) => c.name));
  return events
    .filter((e) => e.kind === "checks_finished")
    .some((e) => checkResults(e.data).some((c) => !c.passed && passing.has(c.name)));
}

function computeProfileMetrics(history: RunHistory): ProfileMetrics[] {
  const byProfile = new Map<string, HistoryRun[]>();
  for (const run of history.runs) byProfile.set(run.profile!, [...(byProfile.get(run.profile!) ?? []), run]);
  return [...byProfile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([profile, runs]) => {
      const eventsOf = (run: HistoryRun) => history.eventsByRun.get(run.id) ?? [];
      const commandsOf = (run: HistoryRun) => history.commandsByRun.get(run.id) ?? [];
      const delivered = runs.filter((r) => r.status === "delivered");
      const repairedRuns = runs.filter((r) => eventsOf(r).some((e) => e.kind === "repair_started"));
      const firstPass = delivered.filter((r) => !repairedRuns.includes(r));
      const failingChecks = runs.filter((r) =>
        eventsOf(r).some((e) => e.kind === "checks_finished" && checkResults(e.data).some((c) => !c.passed)),
      );
      const repeated = runs.filter((r) => eventsOf(r).some((e) => e.kind === "repeated_failure"));
      const commands = runs.flatMap(commandsOf).filter((c) => !EXPECTED_FAILURE_STAGES.has(c.stage));
      const failedCommands = commands.filter((c) => c.exitCode !== 0 || c.timedOut);
      const walls = runs.map((r) => wallTime(r, eventsOf(r))).filter((w): w is number => w !== null);
      const regressions = runs.map((r) => regressed(eventsOf(r))).filter((r): r is boolean => r !== null);
      const agentRuns = runs.map((r) => eventsOf(r).filter((e) => e.kind === "agent_finished").length);
      const costs = runs.map(runCost);
      const known = costs.filter((c): c is number => c !== null);
      const totalCost = known.length === 0 ? null : known.reduce((sum, c) => sum + c, 0);
      const other: Record<string, number> = {};
      for (const event of runs.flatMap(eventsOf)) {
        if (!KNOWN_KINDS.has(event.kind)) other[event.kind] = (other[event.kind] ?? 0) + 1;
      }
      return {
        profile,
        runs: runs.length,
        delivered: delivered.length,
        failed: runs.filter((r) => r.status === "failed").length,
        cancelled: runs.filter((r) => r.status === "cancelled").length,
        verifiedDeliveryRate: ratio(delivered.length, runs.length),
        firstPassSuccessRate: ratio(firstPass.length, runs.length),
        wallTimeMs: { median: percentile(walls, 50), p95: percentile(walls, 95) },
        commands: commands.length,
        commandFailureRate: ratio(failedCommands.length, commands.length),
        repeatedFailureRate: ratio(repeated.length, failingChecks.length),
        repairSuccessRate: ratio(repairedRuns.filter((r) => r.status === "delivered").length, repairedRuns.length),
        testRegressionRate: ratio(regressions.filter(Boolean).length, regressions.length),
        escalationRate: ratio(runs.filter((r) => eventsOf(r).some((e) => e.kind === "profile_escalated")).length, runs.length),
        agentRunsPerRun: ratio(agentRuns.reduce((sum, n) => sum + n, 0), runs.length),
        cost: {
          estimatedUsd: totalCost,
          perVerifiedSuccessUsd: totalCost === null || delivered.length === 0 ? null : totalCost / delivered.length,
          runsWithoutCost: costs.length - known.length,
        },
        otherEventKinds: other,
      };
    });
}

export async function profileMetrics(database: FactoryDatabase, filter: HistoryFilter = {}): Promise<ProfileMetrics[]> {
  return computeProfileMetrics(await loadRunHistory(database, filter));
}
