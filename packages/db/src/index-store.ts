import { and, count, countDistinct, desc, eq, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  AreaDescription,
  IndexStatus,
  PackageRecord,
  ReferencesResult,
  RepositoryIndex,
  RepositoryIndexData,
  SymbolDescription,
} from "@pr-review/index";
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCES,
  MAX_SIBLINGS,
  MAX_SYMBOL_CANDIDATES,
} from "@pr-review/index";
import type { Database, SessionDatabase } from "./client.js";
import type { IndexCoverage, SymbolRow, TestEdgeRow } from "./index-rows.js";
import {
  batchRows,
  directoryOf,
  escapeLike,
  packageForPath,
  readStoredCoverage,
  toAreaDescription,
  toImportersResult,
  toReferencesResult,
  toSymbolDescription,
} from "./index-rows.js";
import type { NewIndexEdge, NewIndexSymbol } from "./schema.js";
import {
  indexBuilds,
  indexEdges,
  indexFiles,
  indexPackages,
  indexSymbols,
  repoIndex,
} from "./schema.js";

export const SCHEMA_VERSION = 1;

const TEST_EDGE_KIND = "tests";
const REFERENCE_EDGE_KIND = "references";
const IMPORT_EDGE_KIND = "imports";
const INSERT_BATCH = 1000;

// The atomic flip: everything here, including dropping the repository's older builds.
export async function writeIndex(
  client: SessionDatabase,
  repoId: number,
  index: RepositoryIndexData,
  buildMs: number,
): Promise<{ indexId: number }> {
  return client.transaction(async (tx) => {
    const coverage: IndexCoverage = {
      layerA: index.coverage,
      languages: index.layerB?.coverage ?? [],
    };
    const [build] = await tx
      .insert(indexBuilds)
      .values({
        repoId,
        sha: index.sha,
        schemaVersion: index.version,
        coverage,
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

    const symbolRows: { id: number; row: NewIndexSymbol }[] = [];
    for (const symbol of index.layerB?.symbols ?? []) {
      const fileId = fileIds.get(symbol.file);
      if (fileId === undefined) continue;
      symbolRows.push({
        id: symbol.id,
        row: {
          indexId,
          fileId,
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
          endLine: symbol.endLine,
          exported: symbol.exported,
        },
      });
    }

    // RETURNING comes back in insertion order, which is what pairs a row id to its symbol.
    const symbolIds = new Map<number, number>();
    for (const batch of batchRows(symbolRows, INSERT_BATCH)) {
      const inserted = await tx
        .insert(indexSymbols)
        .values(batch.map((s) => s.row))
        .returning({ id: indexSymbols.id });
      if (inserted.length !== batch.length) {
        throw new Error("index_symbols insert returned a different row count");
      }
      batch.forEach((s, i) => {
        const row = inserted[i];
        if (row) symbolIds.set(s.id, row.id);
      });
    }

    const edges: NewIndexEdge[] = index.tests.flatMap((t) => {
      const src = fileIds.get(t.test);
      const dst = fileIds.get(t.source);
      return src === undefined || dst === undefined
        ? []
        : [{ indexId, src, dst, kind: TEST_EDGE_KIND, line: null }];
    });
    for (const reference of index.layerB?.references ?? []) {
      const src = fileIds.get(reference.file);
      const dst = symbolIds.get(reference.symbol);
      if (src === undefined || dst === undefined) continue;
      edges.push({
        indexId,
        src,
        dst,
        kind: REFERENCE_EDGE_KIND,
        line: reference.line,
      });
    }
    for (const edge of index.layerB?.imports ?? []) {
      const src = fileIds.get(edge.from);
      const dst = fileIds.get(edge.to);
      if (src === undefined || dst === undefined) continue;
      edges.push({ indexId, src, dst, kind: IMPORT_EDGE_KIND, line: null });
    }
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

export const writeLayerA = writeIndex;

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
    getSymbol: (path, name) => getSymbol(client, indexId, path, name),
    findReferences: (path, name) =>
      findReferences(client, indexId, path, name),
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
  const coverage = readStoredCoverage(build.coverage);
  return {
    sha: build.sha,
    builtAt: build.builtAt.toISOString(),
    coverage: coverage.layerA,
    languages: coverage.languages,
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

const symbolColumns = {
  id: indexSymbols.id,
  path: indexFiles.path,
  name: indexSymbols.name,
  kind: indexSymbols.kind,
  line: indexSymbols.line,
  endLine: indexSymbols.endLine,
  exported: indexSymbols.exported,
};

// Exported first, then the earliest definition: an overload set answers as its export.
async function readSymbol(
  client: Database,
  indexId: number,
  path: string,
  name: string,
): Promise<SymbolRow | null> {
  const [row] = await client
    .select(symbolColumns)
    .from(indexSymbols)
    .innerJoin(indexFiles, eq(indexSymbols.fileId, indexFiles.id))
    .where(
      and(
        eq(indexSymbols.indexId, indexId),
        eq(indexFiles.path, path),
        eq(indexSymbols.name, name),
      ),
    )
    .orderBy(desc(indexSymbols.exported), indexSymbols.line)
    .limit(1);
  return row ?? null;
}

async function readCandidates(
  client: Database,
  indexId: number,
  path: string,
  name: string,
): Promise<SymbolRow[]> {
  return client
    .select(symbolColumns)
    .from(indexSymbols)
    .innerJoin(indexFiles, eq(indexSymbols.fileId, indexFiles.id))
    .where(
      and(
        eq(indexSymbols.indexId, indexId),
        eq(indexSymbols.name, name),
        ne(indexFiles.path, path),
      ),
    )
    .orderBy(indexFiles.path, desc(indexSymbols.exported), indexSymbols.line)
    .limit(MAX_SYMBOL_CANDIDATES);
}

async function countReferences(
  client: Database,
  indexId: number,
  symbolId: number,
): Promise<{ references: number; files: number }> {
  const [row] = await client
    .select({ references: count(), files: countDistinct(indexEdges.src) })
    .from(indexEdges)
    .where(referenceEdges(indexId, symbolId));
  return { references: row?.references ?? 0, files: row?.files ?? 0 };
}

function referenceEdges(indexId: number, symbolId: number) {
  return and(
    eq(indexEdges.indexId, indexId),
    eq(indexEdges.kind, REFERENCE_EDGE_KIND),
    eq(indexEdges.dst, symbolId),
  );
}

async function getSymbol(
  client: Database,
  indexId: number,
  path: string,
  name: string,
): Promise<SymbolDescription> {
  const [symbol, candidates] = await Promise.all([
    readSymbol(client, indexId, path, name),
    readCandidates(client, indexId, path, name),
  ]);
  const counts = symbol
    ? await countReferences(client, indexId, symbol.id)
    : { references: 0, files: 0 };
  return toSymbolDescription({
    path,
    name,
    symbol,
    candidates,
    inboundReferences: counts.references,
    referencingFiles: counts.files,
  });
}

async function findReferences(
  client: Database,
  indexId: number,
  path: string,
  name?: string,
): Promise<ReferencesResult> {
  if (name === undefined) return readImporters(client, indexId, path);
  const symbol = await readSymbol(client, indexId, path, name);
  if (!symbol) {
    return toReferencesResult({
      path,
      name,
      known: false,
      references: [],
      totalReferences: 0,
      totalFiles: 0,
    });
  }
  const [rows, counts] = await Promise.all([
    client
      .select({ path: indexFiles.path, line: indexEdges.line })
      .from(indexEdges)
      .innerJoin(
        indexFiles,
        and(
          eq(indexFiles.indexId, indexEdges.indexId),
          eq(indexFiles.id, indexEdges.src),
        ),
      )
      .where(referenceEdges(indexId, symbol.id))
      .orderBy(indexFiles.path, indexEdges.line)
      .limit(MAX_REFERENCES),
    countReferences(client, indexId, symbol.id),
  ]);
  return toReferencesResult({
    path,
    name,
    known: true,
    references: rows,
    totalReferences: counts.references,
    totalFiles: counts.files,
  });
}

async function readImporters(
  client: Database,
  indexId: number,
  path: string,
): Promise<ReferencesResult> {
  const [file] = await client
    .select({ id: indexFiles.id })
    .from(indexFiles)
    .where(and(eq(indexFiles.indexId, indexId), eq(indexFiles.path, path)))
    .limit(1);
  if (!file) {
    return toImportersResult({
      path,
      known: false,
      importers: [],
      totalImporters: 0,
    });
  }
  const where = and(
    eq(indexEdges.indexId, indexId),
    eq(indexEdges.kind, IMPORT_EDGE_KIND),
    eq(indexEdges.dst, file.id),
  );
  const [rows, totals] = await Promise.all([
    client
      .selectDistinct({ path: indexFiles.path })
      .from(indexEdges)
      .innerJoin(
        indexFiles,
        and(
          eq(indexFiles.indexId, indexEdges.indexId),
          eq(indexFiles.id, indexEdges.src),
        ),
      )
      .where(where)
      .orderBy(indexFiles.path)
      .limit(MAX_REFERENCE_FILES),
    client
      .select({ value: countDistinct(indexEdges.src) })
      .from(indexEdges)
      .where(where),
  ]);
  return toImportersResult({
    path,
    known: true,
    importers: rows.map((r) => r.path),
    totalImporters: totals[0]?.value ?? rows.length,
  });
}
