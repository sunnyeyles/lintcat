import { and, eq, lt, sql } from "drizzle-orm";

import type { Database } from "./client";
import { workflowJobs, workflowRuns, type WorkflowRun } from "./schema";

export type WorkflowRunInput = Omit<typeof workflowRuns.$inferInsert, "id" | "repoId" | "createdAt">;

export interface WorkflowJobInput {
  githubRunId: number;
  runAttempt: number;
  githubJobId: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  runnerLabels: string[];
}

/** Inserts or advances one run attempt; undefined when the stored row is already as new. */
export async function upsertWorkflowRun(
  database: Database,
  repoId: number,
  input: WorkflowRunInput,
): Promise<WorkflowRun | undefined> {
  const [row] = await database
    .insert(workflowRuns)
    .values({ repoId, ...input })
    .onConflictDoUpdate({
      target: [workflowRuns.githubRunId, workflowRuns.runAttempt],
      set: input,
      // GitHub's updated_at has one-second resolution, so a tie may still finish the run.
      setWhere: sql`${workflowRuns.repoId} = ${repoId} and (${workflowRuns.githubUpdatedAt} < excluded.github_updated_at
        or (${workflowRuns.githubUpdatedAt} = excluded.github_updated_at and ${workflowRuns.status} <> 'completed' and excluded.status = 'completed'))`,
    })
    .returning();
  return row;
}

export type WorkflowJobResult = "stored" | "stale" | "run_not_ingested";

// A job whose run was never stored (a dropped schedule run, or one not seen yet) is skipped.
export async function upsertWorkflowJob(
  database: Database,
  repoId: number,
  { githubRunId, runAttempt, ...job }: WorkflowJobInput,
): Promise<WorkflowJobResult> {
  const [run] = await database
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.repoId, repoId),
        eq(workflowRuns.githubRunId, githubRunId),
        eq(workflowRuns.runAttempt, runAttempt),
      ),
    )
    .limit(1);
  if (!run) return "run_not_ingested";
  const [row] = await database
    .insert(workflowJobs)
    .values({ runId: run.id, ...job })
    .onConflictDoUpdate({
      target: workflowJobs.githubJobId,
      set: job,
      // A completed job is final; a late queued or in_progress delivery must not reopen it.
      setWhere: sql`${workflowJobs.runId} = ${run.id} and ${workflowJobs.status} <> 'completed'`,
    })
    .returning({ id: workflowJobs.id });
  return row ? "stored" : "stale";
}

/** Deletes runs started before `before`, and their jobs with them; returns how many runs. */
export async function pruneWorkflowRuns(database: Database, before: Date): Promise<number> {
  const deleted = await database
    .delete(workflowRuns)
    .where(lt(workflowRuns.runStartedAt, before))
    .returning({ id: workflowRuns.id });
  return deleted.length;
}
