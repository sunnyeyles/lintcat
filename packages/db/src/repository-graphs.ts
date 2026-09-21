/**
 * The repository index at one commit: stored as the gzipped JSON the reviewer
 * sent, never recompressed here, and bounded per repository.
 */
import { decodeRepositoryGraph, type RepositoryGraphSnapshot } from "@pr-review/index";
import type { ReviewRecordGraph } from "@pr-review/schemas";
import { and, desc, eq, notInArray } from "drizzle-orm";

import type { Database } from "./client";
import { repositoryGraphs } from "./schema";

/** Snapshots kept per repository; ingest deletes whatever falls past it. */
export const REPOSITORY_GRAPH_RETENTION = 20;

/** One row per (repo, base sha): reviews sharing a base share the snapshot. */
export async function saveRepositoryGraph(
  database: Database,
  repoId: number,
  baseSha: string,
  graph: ReviewRecordGraph,
): Promise<void> {
  const snapshot = Buffer.from(graph.gzip, "base64");
  await database
    .insert(repositoryGraphs)
    .values({
      repoId,
      baseSha,
      snapshot,
      fileCount: graph.fileCount,
      edgeCount: graph.edgeCount,
    })
    .onConflictDoUpdate({
      target: [repositoryGraphs.repoId, repositoryGraphs.baseSha],
      set: { snapshot, fileCount: graph.fileCount, edgeCount: graph.edgeCount },
    });
  await pruneRepositoryGraphs(database, repoId);
}

/** Deletes every snapshot of the repo but the newest `REPOSITORY_GRAPH_RETENTION`. */
export async function pruneRepositoryGraphs(
  database: Database,
  repoId: number,
): Promise<void> {
  const kept = await database
    .select({ id: repositoryGraphs.id })
    .from(repositoryGraphs)
    .where(eq(repositoryGraphs.repoId, repoId))
    .orderBy(desc(repositoryGraphs.createdAt), desc(repositoryGraphs.id))
    .limit(REPOSITORY_GRAPH_RETENTION);
  if (kept.length === 0) return;
  await database
    .delete(repositoryGraphs)
    .where(
      and(
        eq(repositoryGraphs.repoId, repoId),
        notInArray(
          repositoryGraphs.id,
          kept.map((row) => row.id),
        ),
      ),
    );
}

/** The stored snapshot for one repo and base commit, decompressed. */
export async function findRepositoryGraph(
  database: Database,
  repoId: number,
  baseSha: string,
): Promise<RepositoryGraphSnapshot | undefined> {
  const rows = await database
    .select({ snapshot: repositoryGraphs.snapshot })
    .from(repositoryGraphs)
    .where(
      and(
        eq(repositoryGraphs.repoId, repoId),
        eq(repositoryGraphs.baseSha, baseSha),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? undefined : decodeRepositoryGraph(row.snapshot);
}
