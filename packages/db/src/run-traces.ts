import { desc, eq, sql } from "drizzle-orm";

import type { Database } from "./client";
import { runTraceFiles, runTraces } from "./schema";

export type RunTraceFileInput = { name: string; text: string };

export type RunTraceSummary = {
  runId: string;
  title: string | null;
  startedAt: Date;
  lastSeenAt: Date;
};

/** Upserts the run and overwrites each file; a title, once known, is kept. */
export async function saveRunTraceFiles(
  database: Database,
  runId: string,
  files: readonly RunTraceFileInput[],
  { title, now = new Date() }: { title?: string; now?: Date } = {},
): Promise<void> {
  await database
    .insert(runTraces)
    .values({ runId, title: title ?? null, startedAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: runTraces.runId,
      set: { lastSeenAt: now, title: sql`coalesce(excluded.title, ${runTraces.title})` },
    });
  if (files.length === 0) return;
  await database
    .insert(runTraceFiles)
    .values(files.map((file) => ({ runId, fileName: file.name, text: file.text, updatedAt: now })))
    .onConflictDoUpdate({
      target: [runTraceFiles.runId, runTraceFiles.fileName],
      set: { text: sql`excluded.text`, updatedAt: now },
    });
}

export async function listRunTraces(database: Database, limit = 50): Promise<RunTraceSummary[]> {
  return database
    .select({
      runId: runTraces.runId,
      title: runTraces.title,
      startedAt: runTraces.startedAt,
      lastSeenAt: runTraces.lastSeenAt,
    })
    .from(runTraces)
    .orderBy(desc(runTraces.lastSeenAt))
    .limit(limit);
}

export async function findRunTrace(
  database: Database,
  runId: string,
): Promise<{ run: RunTraceSummary; files: RunTraceFileInput[] } | undefined> {
  const runs = await database
    .select({
      runId: runTraces.runId,
      title: runTraces.title,
      startedAt: runTraces.startedAt,
      lastSeenAt: runTraces.lastSeenAt,
    })
    .from(runTraces)
    .where(eq(runTraces.runId, runId))
    .limit(1);
  const run = runs[0];
  if (!run) return undefined;
  const files = await database
    .select({ name: runTraceFiles.fileName, text: runTraceFiles.text })
    .from(runTraceFiles)
    .where(eq(runTraceFiles.runId, runId))
    .orderBy(runTraceFiles.fileName);
  return { run, files };
}
