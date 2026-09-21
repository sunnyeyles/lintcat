import {
  buildRepositoryIndex,
  encodeRepositoryGraph,
  snapshotRepositoryIndex,
  type RepositoryGraphSnapshot,
} from "@pr-review/index";
import type { ReviewRecordGraph } from "@pr-review/schemas";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  findRepositoryGraph,
  pruneRepositoryGraphs,
  saveRepositoryGraph,
  REPOSITORY_GRAPH_RETENTION,
} from "./repository-graphs";
import { organizations, repos, repositoryGraphs } from "./schema";
import { createTestDatabase } from "./test-database";

function shaOf(seed: number): string {
  return seed.toString(16).padStart(40, "0");
}

function snapshotAt(sha: string): RepositoryGraphSnapshot {
  return snapshotRepositoryIndex(
    buildRepositoryIndex({
      sha,
      files: new Map([
        ["src/session.ts", "export const session = 1;\n"],
        ["src/login.ts", "import { session } from './session';\n"],
      ]),
    }),
  );
}

function graphOf(snapshot: RepositoryGraphSnapshot): ReviewRecordGraph {
  return {
    gzip: Buffer.from(encodeRepositoryGraph(snapshot)).toString("base64"),
    fileCount: snapshot.files.length,
    edgeCount: snapshot.edges.length,
  };
}

let database: Database;
let repoId: number;
let otherRepoId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({
      githubAccountId: 100,
      accountType: "organization",
      slug: "acme",
      name: "Acme",
    })
    .returning({ id: organizations.id });
  const inserted = await database
    .insert(repos)
    .values([
      { organizationId: organization!.id, owner: "acme", name: "widgets" },
      { organizationId: organization!.id, owner: "acme", name: "gadgets" },
    ])
    .returning({ id: repos.id });
  repoId = inserted[0]!.id;
  otherRepoId = inserted[1]!.id;
});

describe("saveRepositoryGraph", () => {
  it("stores the snapshot with its counts and reads it back decompressed", async () => {
    const snapshot = snapshotAt(shaOf(1));
    await saveRepositoryGraph(database, repoId, snapshot.sha, graphOf(snapshot));

    const rows = await database.select().from(repositoryGraphs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repoId,
      baseSha: snapshot.sha,
      fileCount: 2,
      edgeCount: 1,
    });
    expect(await findRepositoryGraph(database, repoId, snapshot.sha)).toEqual(
      snapshot,
    );
  });

  it("keeps one row per base sha and refreshes what it holds", async () => {
    const snapshot = snapshotAt(shaOf(1));
    await saveRepositoryGraph(database, repoId, snapshot.sha, graphOf(snapshot));
    const rebuilt = snapshotRepositoryIndex(
      buildRepositoryIndex({
        sha: snapshot.sha,
        files: new Map([["src/only.ts", "export const only = 1;\n"]]),
      }),
    );
    await saveRepositoryGraph(database, repoId, snapshot.sha, graphOf(rebuilt));

    expect(await database.select().from(repositoryGraphs)).toHaveLength(1);
    expect(await findRepositoryGraph(database, repoId, snapshot.sha)).toEqual(
      rebuilt,
    );
  });

  it("gives each repository its own row for the same base sha", async () => {
    const snapshot = snapshotAt(shaOf(1));
    await saveRepositoryGraph(database, repoId, snapshot.sha, graphOf(snapshot));
    await saveRepositoryGraph(
      database,
      otherRepoId,
      snapshot.sha,
      graphOf(snapshot),
    );
    expect(await database.select().from(repositoryGraphs)).toHaveLength(2);
  });
});

describe("findRepositoryGraph", () => {
  it("is undefined for a base sha or repository with no snapshot", async () => {
    const snapshot = snapshotAt(shaOf(1));
    await saveRepositoryGraph(database, repoId, snapshot.sha, graphOf(snapshot));
    expect(
      await findRepositoryGraph(database, repoId, shaOf(2)),
    ).toBeUndefined();
    expect(
      await findRepositoryGraph(database, otherRepoId, snapshot.sha),
    ).toBeUndefined();
  });
});

describe("pruneRepositoryGraphs", () => {
  async function storedShas(id: number): Promise<string[]> {
    const rows = await database
      .select({ baseSha: repositoryGraphs.baseSha })
      .from(repositoryGraphs)
      .where(eq(repositoryGraphs.repoId, id))
      .orderBy(asc(repositoryGraphs.id));
    return rows.map((row) => row.baseSha);
  }

  it("keeps the newest snapshots and deletes what falls past the limit", async () => {
    const stored = REPOSITORY_GRAPH_RETENTION + 3;
    for (let seed = 1; seed <= stored; seed += 1) {
      const snapshot = snapshotAt(shaOf(seed));
      await saveRepositoryGraph(
        database,
        repoId,
        snapshot.sha,
        graphOf(snapshot),
      );
    }

    expect(await storedShas(repoId)).toEqual(
      Array.from({ length: REPOSITORY_GRAPH_RETENTION }, (_, offset) =>
        shaOf(stored - REPOSITORY_GRAPH_RETENTION + offset + 1),
      ),
    );
  });

  it("bounds each repository on its own", async () => {
    const snapshot = snapshotAt(shaOf(1));
    await saveRepositoryGraph(
      database,
      otherRepoId,
      snapshot.sha,
      graphOf(snapshot),
    );
    for (let seed = 1; seed <= REPOSITORY_GRAPH_RETENTION + 1; seed += 1) {
      const kept = snapshotAt(shaOf(seed));
      await saveRepositoryGraph(database, repoId, kept.sha, graphOf(kept));
    }

    expect(await storedShas(otherRepoId)).toEqual([snapshot.sha]);
    expect(await storedShas(repoId)).toHaveLength(REPOSITORY_GRAPH_RETENTION);
  });

  it("does nothing for a repository with no snapshots", async () => {
    await pruneRepositoryGraphs(database, repoId);
    expect(await database.select().from(repositoryGraphs)).toHaveLength(0);
  });
});
