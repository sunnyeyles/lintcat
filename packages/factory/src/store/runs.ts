/** The factory's run queue and audit log: plain functions over a `FactoryDatabase`. */
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import type { TaskContract } from "#src/contract";
import type { FactoryDatabase } from "#src/store/client";
import {
  factoryCommands,
  factoryEffects,
  factoryEvents,
  factoryRuns,
  type Checkpoint,
  type FactoryCommand,
  type FactoryEffect,
  type FactoryEvent,
  type FactoryRun,
  type FactoryRunStatus,
  type RunOutcome,
} from "#src/store/schema";

const EDITABLE = ["draft", "awaiting_approval"] as const;
const ACTIVE = ["running", "verifying"] as const;

const lease = (leaseMs: number) => sql`now() + ${`${leaseMs} milliseconds`}::interval`;

async function guardedUpdate(
  database: FactoryDatabase,
  id: string,
  statuses: readonly FactoryRunStatus[],
  set: PgUpdateSetSource<typeof factoryRuns>,
): Promise<FactoryRun | undefined> {
  const [row] = await database
    .update(factoryRuns)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(factoryRuns.id, id), inArray(factoryRuns.status, [...statuses])))
    .returning();
  return row;
}

export async function createRun(
  database: FactoryDatabase,
  input: {
    id: string;
    repoPath: string;
    title: string;
    contract: TaskContract;
    status?: "draft" | "awaiting_approval";
  },
): Promise<FactoryRun> {
  const [row] = await database.insert(factoryRuns).values(input).returning();
  return row!;
}

export async function updateDraft(
  database: FactoryDatabase,
  id: string,
  input: {
    contract: TaskContract;
    title: string;
    status: "draft" | "awaiting_approval";
    profile?: string;
  },
): Promise<FactoryRun | undefined> {
  return guardedUpdate(database, id, EDITABLE, input);
}

export async function approveRun(
  database: FactoryDatabase,
  id: string,
  contract: TaskContract,
  approval: { profile: string; workflowVersion: string; contractHash: string; baseSha: string },
): Promise<boolean> {
  const row = await guardedUpdate(database, id, EDITABLE, {
    ...approval,
    contract,
    status: "queued",
  });
  return row !== undefined;
}

/** Queued and not cancelled, or active on a lapsed lease (a crashed runner). */
function claimable(database: FactoryDatabase, runId?: string) {
  const due = or(
    and(eq(factoryRuns.status, "queued"), eq(factoryRuns.cancelRequested, false)),
    and(inArray(factoryRuns.status, [...ACTIVE]), lt(factoryRuns.leaseExpiresAt, sql`now()`)),
  );
  return database
    .select({ id: factoryRuns.id })
    .from(factoryRuns)
    .where(runId === undefined ? due : and(due, eq(factoryRuns.id, runId)))
    .orderBy(asc(factoryRuns.createdAt), asc(factoryRuns.id))
    .limit(1)
    .for("update", { skipLocked: true });
}

/** One statement, so two runners never claim the same run. */
export async function claimRun(
  database: FactoryDatabase,
  { leaseMs, runId }: { leaseMs: number; runId?: string },
): Promise<FactoryRun | undefined> {
  const [row] = await database
    .update(factoryRuns)
    .set({
      status: "running",
      attempts: sql`${factoryRuns.attempts} + 1`,
      leaseExpiresAt: lease(leaseMs),
      updatedAt: sql`now()`,
    })
    .where(inArray(factoryRuns.id, claimable(database, runId)))
    .returning();
  return row;
}

export async function renewLease(
  database: FactoryDatabase,
  id: string,
  leaseMs: number,
): Promise<{ alive: boolean; cancelRequested: boolean }> {
  const [row] = await database
    .update(factoryRuns)
    .set({ leaseExpiresAt: lease(leaseMs) })
    .where(and(eq(factoryRuns.id, id), inArray(factoryRuns.status, [...ACTIVE])))
    .returning({ cancelRequested: factoryRuns.cancelRequested });
  if (row) return { alive: true, cancelRequested: row.cancelRequested };
  const [current] = await database
    .select({ cancelRequested: factoryRuns.cancelRequested })
    .from(factoryRuns)
    .where(eq(factoryRuns.id, id));
  return { alive: false, cancelRequested: current?.cancelRequested ?? false };
}

export async function saveProgress(
  database: FactoryDatabase,
  id: string,
  progress: {
    stage?: string;
    status?: "running" | "verifying";
    checkpoint?: Checkpoint;
    agentSessionId?: string;
    branch?: string;
    worktreePath?: string;
    contract?: TaskContract;
  },
): Promise<boolean> {
  return (await guardedUpdate(database, id, ACTIVE, progress)) !== undefined;
}

export async function noteRecovery(database: FactoryDatabase, id: string): Promise<number> {
  const [row] = await database
    .update(factoryRuns)
    .set({ recoveries: sql`${factoryRuns.recoveries} + 1`, updatedAt: sql`now()` })
    .where(eq(factoryRuns.id, id))
    .returning({ recoveries: factoryRuns.recoveries });
  return row?.recoveries ?? 0;
}

/** False when another runner or a cancel already settled it. */
export async function settleRun(
  database: FactoryDatabase,
  id: string,
  result: { status: "delivered" | "failed" | "cancelled"; outcome: RunOutcome; blocker?: string },
): Promise<boolean> {
  const row = await guardedUpdate(database, id, ACTIVE, {
    status: result.status,
    outcome: result.outcome,
    blocker: result.blocker ?? null,
    finishedAt: sql`now()`,
    leaseExpiresAt: null,
  });
  return row !== undefined;
}

export type CancelResult = "cancelled" | "requested" | "finished" | "missing";

export async function requestCancel(database: FactoryDatabase, id: string): Promise<CancelResult> {
  const idle = await guardedUpdate(database, id, [...EDITABLE, "queued"], {
    status: "cancelled",
    cancelRequested: true,
    finishedAt: sql`now()`,
  });
  if (idle) return "cancelled";
  const active = await guardedUpdate(database, id, ACTIVE, { cancelRequested: true });
  if (active) return "requested";
  return (await getRun(database, id)) ? "finished" : "missing";
}

export async function getRun(database: FactoryDatabase, id: string): Promise<FactoryRun | undefined> {
  const [row] = await database.select().from(factoryRuns).where(eq(factoryRuns.id, id));
  return row;
}

export function listRuns(
  database: FactoryDatabase,
  { limit, repoPath }: { limit: number; repoPath?: string },
): Promise<FactoryRun[]> {
  return database
    .select()
    .from(factoryRuns)
    .where(repoPath === undefined ? undefined : eq(factoryRuns.repoPath, repoPath))
    .orderBy(desc(factoryRuns.createdAt), desc(factoryRuns.id))
    .limit(limit);
}

export interface EventInput {
  runId: string;
  kind: string;
  stage?: string;
  agentId?: string;
  workflowVersion?: string;
  promptVersion?: string;
  toolVersion?: string;
  repositorySha?: string;
  data?: Record<string, unknown>;
}

export async function appendEvent(database: FactoryDatabase, event: EventInput): Promise<FactoryEvent> {
  const [row] = await database.insert(factoryEvents).values(event).returning();
  return row!;
}

export function listEvents(
  database: FactoryDatabase,
  runId: string,
  { afterId, limit = 1000 }: { afterId?: number; limit?: number } = {},
): Promise<FactoryEvent[]> {
  const conditions: SQL[] = [eq(factoryEvents.runId, runId)];
  if (afterId !== undefined) conditions.push(gt(factoryEvents.id, afterId));
  return database
    .select()
    .from(factoryEvents)
    .where(and(...conditions))
    .orderBy(asc(factoryEvents.id))
    .limit(limit);
}

export type CommandInput = Omit<FactoryCommand, "id" | "errorCategory"> & {
  errorCategory?: string | null;
};

export async function recordCommand(
  database: FactoryDatabase,
  command: CommandInput,
): Promise<FactoryCommand> {
  const [row] = await database.insert(factoryCommands).values(command).returning();
  return row!;
}

export function listCommands(database: FactoryDatabase, runId: string): Promise<FactoryCommand[]> {
  return database
    .select()
    .from(factoryCommands)
    .where(eq(factoryCommands.runId, runId))
    .orderBy(asc(factoryCommands.id));
}

export async function findEffect(
  database: FactoryDatabase,
  key: string,
): Promise<FactoryEffect | undefined> {
  const [row] = await database.select().from(factoryEffects).where(eq(factoryEffects.key, key));
  return row;
}

/** The first write for a key wins; a repeat returns the stored row unchanged. */
export async function recordEffect(
  database: FactoryDatabase,
  effect: { key: string; runId: string; kind: string; result: unknown },
): Promise<FactoryEffect> {
  await database.insert(factoryEffects).values(effect).onConflictDoNothing();
  return (await findEffect(database, effect.key))!;
}

/** Drops the event and command detail of runs that finished before the cutoff; the run rows stay. */
export async function pruneRunHistory(
  database: FactoryDatabase,
  cutoff: Date,
): Promise<{ runs: number; events: number; commands: number }> {
  const old = database
    .select({ id: factoryRuns.id })
    .from(factoryRuns)
    .where(and(inArray(factoryRuns.status, ["delivered", "failed", "cancelled"]), lt(factoryRuns.finishedAt, cutoff)));
  return database.transaction(async (tx) => {
    const events = await tx.delete(factoryEvents).where(inArray(factoryEvents.runId, old)).returning({ runId: factoryEvents.runId });
    const commands = await tx.delete(factoryCommands).where(inArray(factoryCommands.runId, old)).returning({ runId: factoryCommands.runId });
    const runs = new Set([...events, ...commands].map((row) => row.runId));
    return { runs: runs.size, events: events.length, commands: commands.length };
  });
}

export interface ProfileSummary {
  profile: string;
  runs: number;
  delivered: number;
  failed: number;
  cancelled: number;
  medianDurationMs: number | null;
}

export async function profileSummary(database: FactoryDatabase): Promise<ProfileSummary[]> {
  const rows = await database
    .select({
      profile: factoryRuns.profile,
      status: factoryRuns.status,
      createdAt: factoryRuns.createdAt,
      finishedAt: factoryRuns.finishedAt,
    })
    .from(factoryRuns)
    .where(isNotNull(factoryRuns.profile));
  const byProfile = new Map<string, { summary: ProfileSummary; durations: number[] }>();
  for (const row of rows) {
    const profile = row.profile!;
    let entry = byProfile.get(profile);
    if (!entry) {
      entry = {
        summary: { profile, runs: 0, delivered: 0, failed: 0, cancelled: 0, medianDurationMs: null },
        durations: [],
      };
      byProfile.set(profile, entry);
    }
    entry.summary.runs += 1;
    if (row.status === "delivered" || row.status === "failed" || row.status === "cancelled") {
      entry.summary[row.status] += 1;
    }
    if (row.finishedAt) entry.durations.push(row.finishedAt.getTime() - row.createdAt.getTime());
  }
  return [...byProfile.values()]
    .map(({ summary, durations }) => ({ ...summary, medianDurationMs: median(durations) }))
    .sort((a, b) => a.profile.localeCompare(b.profile));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
