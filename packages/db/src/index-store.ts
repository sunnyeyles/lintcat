import { and, count, eq, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  AreaDescription,
  IndexStatus,
  LayerAIndex,
  PackageRecord,
  RepositoryIndex,
} from "@pr-review/index";
import { MAX_SIBLINGS } from "@pr-review/index";
import type { Database, SessionDatabase } from "./client.js";
import type { TestEdgeRow } from "./index-rows.js";
import {
  batchRows,
  directoryOf,
  escapeLike,
  packageForPath,
  toAreaDescription,
} from "./index-rows.js";
import {
  indexBuilds,
  indexEdges,
  indexFiles,
  indexPackages,
  repoIndex,
} from "./schema.js";

export const SCHEMA_VERSION = 1;

const TEST_EDGE_KIND = "tests";
const INSERT_BATCH = 1000;

// The atomic flip: everything here, including dropping the repository's older builds.
export async function writeLayerA(
  client: SessionDatabase,
  repoId: number,
  index: LayerAIndex,
  buildMs: number,
): Promise<{ indexId: number }> {
  return client.transaction(async (tx) => {
    const [build] = await tx
      .insert(indexBuilds)
      .values({
        repoId,
        sha: index.sha,
        schemaVersion: index.version,
        coverage: index.coverage,
        builtAt: new Date(index.builtAt),
        buildMs,
      })
      .returning({ id: indexBuilds.id });
    if (!build) throw new Error("index_builds insert returned no row");
    const indexId = build.id;

    const packageIds = new Map<string, number>();
    for (const batch of batchRows(index.packages, INSERT_BATCH)) {
      const inserted = await tx
        .insert(indexPackages)
        .values(
          batch.map((p) => ({
            indexId,
            name: p.name,
            root: p.root,
            entryPoints: [...p.entryPoints],
            dependsOn: [...p.dependsOn],
          })),
        )
        .returning({ id: indexPackages.id, name: indexPackages.name });
      for (const row of inserted) packageIds.set(row.name, row.id);
    }

    const fileIds = new Map<string, number>();
    for (const batch of batchRows(index.files, INSERT_BATCH)) {
      const inserted = await tx
        .insert(indexFiles)
        .values(
          batch.map((f) => ({
            indexId,
            path: f.path,
            packageId:
              f.package === null ? null : (packageIds.get(f.package) ?? null),
            role: f.role,
            language: f.language,
            owners: [...f.owners],
          })),
        )
        .returning({ id: indexFiles.id, path: indexFiles.path });
      for (const row of inserted) fileIds.set(row.path, row.id);
    }

    const edges = index.tests.flatMap((t) => {
      const src = fileIds.get(t.test);
      const dst = fileIds.get(t.source);
      return src === undefined || dst === undefined
        ? []
        : [{ indexId, src, dst, kind: TEST_EDGE_KIND }];
    });
    for (const batch of batchRows(edges, INSERT_BATCH)) {
      await tx.insert(indexEdges).values(batch);
    }

    await tx
      .insert(repoIndex)
      .values({
        repoId,
        currentIndexId: indexId,
        status: "ready",
        failureReason: null,
      })
      .onConflictDoUpdate({
        target: repoIndex.repoId,
        set: {
          currentIndexId: indexId,
          status: "ready",
          failureReason: null,
          updatedAt: new Date(),
        },
      });

    await tx
      .delete(indexBuilds)
      .where(and(eq(indexBuilds.repoId, repoId), ne(indexBuilds.id, indexId)));

    return { indexId };
  });
}

export async function markBuilding(
  client: Database,
  repoId: number,
  defaultBranch: string,
): Promise<void> {
  await client
    .insert(repoIndex)
    .values({ repoId, status: "building", defaultBranch, failureReason: null })
    .onConflictDoUpdate({
      target: repoIndex.repoId,
      set: {
        status: "building",
        defaultBranch,
        failureReason: null,
        updatedAt: new Date(),
      },
    });
}

// current_index_id is left alone: the previous index stays served, flagged stale.
export async function markFailed(
  client: Database,
  repoId: number,
  reason: string,
): Promise<void> {
  await client
    .update(repoIndex)
    .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
    .where(eq(repoIndex.repoId, repoId));
}

// Absent mode is undefined: no current build, or one from a schema we do not read.
export async function createPostgresRepositoryIndex(
  client: Database,
  repoId: number,
): Promise<RepositoryIndex | undefined> {
  const [row] = await client
    .select({
      indexId: indexBuilds.id,
      schemaVersion: indexBuilds.schemaVersion,
    })
    .from(repoIndex)
    .innerJoin(indexBuilds, eq(repoIndex.currentIndexId, indexBuilds.id))
    .where(eq(repoIndex.repoId, repoId))
    .limit(1);
  if (!row || row.schemaVersion !== SCHEMA_VERSION) return undefined;
  const indexId = row.indexId;
  return {
    status: () => readStatus(client, indexId),
    describeArea: (path) => describeArea(client, indexId, path),
  };
}

async function readStatus(
  client: Database,
  indexId: number,
): Promise<IndexStatus> {
  const [build] = await client
    .select({
      sha: indexBuilds.sha,
      builtAt: indexBuilds.builtAt,
      coverage: indexBuilds.coverage,
    })
    .from(indexBuilds)
    .where(eq(indexBuilds.id, indexId))
    .limit(1);
  if (!build) throw new Error(`index build ${indexId} no longer exists`);
  return {
    sha: build.sha,
    builtAt: build.builtAt.toISOString(),
    coverage: build.coverage,
  };
}

async function describeArea(
  client: Database,
  indexId: number,
  path: string,
): Promise<AreaDescription> {
  const [file] = await client
    .select({
      id: indexFiles.id,
      role: indexFiles.role,
      language: indexFiles.language,
      owners: indexFiles.owners,
      name: indexPackages.name,
      root: indexPackages.root,
      entryPoints: indexPackages.entryPoints,
      dependsOn: indexPackages.dependsOn,
    })
    .from(indexFiles)
    .leftJoin(indexPackages, eq(indexFiles.packageId, indexPackages.id))
    .where(and(eq(indexFiles.indexId, indexId), eq(indexFiles.path, path)))
    .limit(1);

  const [siblings, testEdges, pkg] = await Promise.all([
    readSiblings(client, indexId, path),
    file ? readTestEdges(client, indexId, file.id) : [],
    file
      ? file.name === null
        ? null
        : {
            name: file.name,
            root: file.root ?? "",
            entryPoints: file.entryPoints ?? [],
            dependsOn: file.dependsOn ?? [],
          }
      : readPackage(client, indexId, path),
  ]);

  return toAreaDescription({
    path,
    fileId: file?.id ?? null,
    role: file?.role ?? null,
    language: file?.language ?? null,
    owners: file?.owners ?? [],
    package: pkg,
    testEdges,
    siblings: siblings.siblings,
    siblingsTotal: siblings.siblingsTotal,
  });
}

const testFiles = alias(indexFiles, "test_files");
const sourceFiles = alias(indexFiles, "source_files");

async function readTestEdges(
  client: Database,
  indexId: number,
  fileId: number,
): Promise<TestEdgeRow[]> {
  return client
    .select({
      src: indexEdges.src,
      dst: indexEdges.dst,
      testPath: testFiles.path,
      sourcePath: sourceFiles.path,
    })
    .from(indexEdges)
    .innerJoin(
      testFiles,
      and(
        eq(testFiles.indexId, indexEdges.indexId),
        eq(testFiles.id, indexEdges.src),
      ),
    )
    .innerJoin(
      sourceFiles,
      and(
        eq(sourceFiles.indexId, indexEdges.indexId),
        eq(sourceFiles.id, indexEdges.dst),
      ),
    )
    .where(
      and(
        eq(indexEdges.indexId, indexId),
        eq(indexEdges.kind, TEST_EDGE_KIND),
        or(eq(indexEdges.src, fileId), eq(indexEdges.dst, fileId)),
      ),
    );
}

async function readSiblings(
  client: Database,
  indexId: number,
  path: string,
): Promise<{ siblings: string[]; siblingsTotal: number }> {
  const prefix = escapeLike(directoryOf(path));
  const where = and(
    eq(indexFiles.indexId, indexId),
    ne(indexFiles.path, path),
    sql`${indexFiles.path} LIKE ${`${prefix}%`} ESCAPE '\\'`,
    sql`${indexFiles.path} NOT LIKE ${`${prefix}%/%`} ESCAPE '\\'`,
  );
  const [rows, totals] = await Promise.all([
    client
      .select({ path: indexFiles.path })
      .from(indexFiles)
      .where(where)
      .orderBy(indexFiles.path)
      .limit(MAX_SIBLINGS),
    client.select({ value: count() }).from(indexFiles).where(where),
  ]);
  return {
    siblings: rows.map((r) => r.path),
    siblingsTotal: totals[0]?.value ?? rows.length,
  };
}

async function readPackage(
  client: Database,
  indexId: number,
  path: string,
): Promise<PackageRecord | null> {
  const rows = await client
    .select({
      name: indexPackages.name,
      root: indexPackages.root,
      entryPoints: indexPackages.entryPoints,
      dependsOn: indexPackages.dependsOn,
    })
    .from(indexPackages)
    .where(eq(indexPackages.indexId, indexId));
  return packageForPath(rows, path);
}
