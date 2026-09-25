import {
  buildRepositoryIndex,
  encodeRepositoryGraph,
  snapshotRepositoryIndex,
  type RepositoryGraphSnapshot,
} from "@pr-review/index";
import type {
  ReviewRecord,
  ReviewRecordChangedFile,
  ReviewRecordGraph,
  ReviewRecordRisk,
} from "@pr-review/schemas";
import { asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  ingestReviewRecord,
} from "./ingest";
import {
  findRepositoryGraph,
  REPOSITORY_GRAPH_RETENTION,
} from "./repository-graphs";
import {
  findings,
  organizations,
  repos,
  repositoryGraphs,
  reviews,
} from "./schema";
import { createTestDatabase } from "./test-database";

const record: ReviewRecord = {
  owner: "acme",
  repo: "widgets",
  prNumber: 7,
  headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567",
  summary: "One high severity finding.",
  durationMs: 45_000,
  inputTokens: 21_000,
  cacheCreationInputTokens: 4_000,
  cacheReadInputTokens: 20_000,
  outputTokens: 1_300,
  findings: [
    {
      file: "src/auth/session.ts",
      line: 84,
      category: "security",
      severity: "high",
      title: "Missing tenant validation",
      explanation: "The session query is not filtered by tenant.",
      suggestedFix: "Filter by the authenticated tenant id.",
      confidence: 0.9,
    },
    {
      file: "src/list.ts",
      category: "performance",
      severity: "low",
      title: "Quadratic scan",
      explanation: "The inner loop rescans the whole list.",
      confidence: 0.4,
    },
  ],
};

let database: Database;
let organizationId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const inserted = await database
    .insert(organizations)
    .values({
      githubAccountId: 100,
      accountType: "organization",
      slug: "acme",
      name: "Acme",
    })
    .returning({ id: organizations.id });
  organizationId = inserted[0]!.id;
});

describe("ingestReviewRecord", () => {
  it("creates the repo, the review and the findings", async () => {
    const result = await ingestReviewRecord(database, organizationId, record);
    expect(result).toEqual({ ok: true, reviewId: expect.any(Number) });
    if (!result.ok) return;

    const repoRows = await database.select().from(repos);
    expect(repoRows).toHaveLength(1);
    expect(repoRows[0]).toMatchObject({
      organizationId,
      owner: "acme",
      name: "widgets",
    });

    const reviewRows = await database
      .select()
      .from(reviews)
      .where(eq(reviews.id, result.reviewId));
    expect(reviewRows[0]).toMatchObject({
      repoId: repoRows[0]!.id,
      prNumber: 7,
      headSha: record.headSha,
      summary: "One high severity finding.",
      durationMs: 45_000,
      inputTokens: 21_000,
      cacheCreationInputTokens: 4_000,
      cacheReadInputTokens: 20_000,
      outputTokens: 1_300,
    });

    const findingRows = await database
      .select()
      .from(findings)
      .where(eq(findings.reviewId, result.reviewId))
      .orderBy(asc(findings.id));
    expect(findingRows).toHaveLength(2);
    expect(findingRows[0]).toMatchObject({
      file: "src/auth/session.ts",
      line: 84,
      category: "security",
      severity: "high",
      title: "Missing tenant validation",
      suggestedFix: "Filter by the authenticated tenant id.",
    });
    expect(findingRows[0]?.confidence).toBeCloseTo(0.9, 5);
    expect(findingRows[1]).toMatchObject({
      line: null,
      suggestedFix: null,
      title: "Quadratic scan",
    });
  });

  it("updates rather than duplicates on a rerun of the same commit", async () => {
    const first = await ingestReviewRecord(database, organizationId, record);
    const rerun: ReviewRecord = {
      ...record,
      summary: "Now only one finding.",
      durationMs: 30_000,
      outputTokens: 400,
      findings: [record.findings[1]!],
    };
    const second = await ingestReviewRecord(database, organizationId, rerun);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reviewId).toBe(first.reviewId);

    expect(await database.select().from(reviews)).toHaveLength(1);
    expect(await database.select().from(repos)).toHaveLength(1);

    const findingRows = await database.select().from(findings);
    expect(findingRows).toHaveLength(1);
    expect(findingRows[0]).toMatchObject({ title: "Quadratic scan" });

    const reviewRows = await database.select().from(reviews);
    expect(reviewRows[0]).toMatchObject({
      summary: "Now only one finding.",
      durationMs: 30_000,
      outputTokens: 400,
    });
  });

  it("keeps a different head sha as its own review", async () => {
    await ingestReviewRecord(database, organizationId, record);
    await ingestReviewRecord(database, organizationId, {
      ...record,
      headSha: "aaaabbbbccccddddeeeeffff00001111222233334",
    });
    expect(await database.select().from(reviews)).toHaveLength(2);
    expect(await database.select().from(repos)).toHaveLength(1);
  });

  it("reports owner-mismatch when the owner is not the organization's login", async () => {
    const result = await ingestReviewRecord(database, organizationId, {
      ...record,
      owner: "someone-else",
    });
    expect(result).toEqual({ ok: false, reason: "owner-mismatch" });
    expect(await database.select().from(repos)).toHaveLength(0);
  });

  it("matches the login case-insensitively", async () => {
    const result = await ingestReviewRecord(database, organizationId, {
      ...record,
      owner: "AcMe",
    });
    expect(result.ok).toBe(true);
  });

  it("reports owner-mismatch for another organization's repo", async () => {
    const inserted = await database
      .insert(organizations)
      .values({
        githubAccountId: 200,
        accountType: "user",
        slug: "octocat",
        name: "Octocat",
      })
      .returning({ id: organizations.id });
    const result = await ingestReviewRecord(database, inserted[0]!.id, record);
    expect(result).toEqual({ ok: false, reason: "owner-mismatch" });
  });

  it("reports organization-not-found for an unknown organization", async () => {
    const result = await ingestReviewRecord(database, organizationId + 999, record);
    expect(result).toEqual({ ok: false, reason: "organization-not-found" });
  });

  it("treats an uninstalled organization as unknown", async () => {
    await database
      .update(organizations)
      .set({ uninstalledAt: new Date() })
      .where(eq(organizations.id, organizationId));
    expect(await ingestReviewRecord(database, organizationId, record)).toEqual({
      ok: false,
      reason: "organization-not-found",
    });
    expect(await database.select().from(reviews)).toEqual([]);
  });

  it("rejects a removed repo and leaves its reviews as they were", async () => {
    await ingestReviewRecord(database, organizationId, record);
    await database.update(repos).set({ removedAt: new Date() });
    const before = await database.select().from(reviews);

    const result = await ingestReviewRecord(database, organizationId, {
      ...record,
      headSha: "f".repeat(40),
    });

    expect(result).toEqual({ ok: false, reason: "repo-removed" });
    expect(await database.select().from(reviews)).toEqual(before);
  });
});

function shaOf(seed: number): string {
  return seed.toString(16).padStart(40, "0");
}

function snapshotAt(sha: string) {
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

const changedFiles: ReviewRecordChangedFile[] = [
  { path: "src/auth/session.ts", status: "modified", additions: 12, deletions: 3 },
  { path: "src/gone.ts", status: "removed", additions: 0, deletions: 40 },
];

const snapshot = snapshotAt(shaOf(1));

const withGraph: ReviewRecord = {
  ...record,
  baseSha: snapshot.sha,
  changedFiles,
  graph: graphOf(snapshot),
};

async function repoIdOf(): Promise<number> {
  const rows = await database.select({ id: repos.id }).from(repos);
  return rows[0]!.id;
}

describe("ingestReviewRecord, with a repository graph", () => {
  it("stores the snapshot, the base sha and the changed files", async () => {
    const result = await ingestReviewRecord(database, organizationId, withGraph);
    expect(result.ok).toBe(true);

    const [review] = await database.select().from(reviews);
    expect(review).toMatchObject({ baseSha: snapshot.sha, changedFiles });

    const rows = await database.select().from(repositoryGraphs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ baseSha: snapshot.sha, fileCount: 2, edgeCount: 1 });
    expect(
      await findRepositoryGraph(database, await repoIdOf(), snapshot.sha),
    ).toEqual(snapshot);
  });

  it("neither duplicates nor corrupts the snapshot on a re-ingest", async () => {
    await ingestReviewRecord(database, organizationId, withGraph);
    const first = await ingestReviewRecord(database, organizationId, withGraph);
    expect(first.ok).toBe(true);

    expect(await database.select().from(repositoryGraphs)).toHaveLength(1);
    expect(await database.select().from(reviews)).toHaveLength(1);
    expect(
      await findRepositoryGraph(database, await repoIdOf(), snapshot.sha),
    ).toEqual(snapshot);
  });

  it("shares one snapshot between reviews of the same base sha", async () => {
    await ingestReviewRecord(database, organizationId, withGraph);
    await ingestReviewRecord(database, organizationId, {
      ...withGraph,
      prNumber: 8,
      headSha: "aaaabbbbccccddddeeeeffff00001111222233334",
    });

    expect(await database.select().from(reviews)).toHaveLength(2);
    expect(await database.select().from(repositoryGraphs)).toHaveLength(1);
  });

  it("ingests a review whose index was off, with no snapshot and no base sha", async () => {
    const result = await ingestReviewRecord(database, organizationId, record);
    expect(result.ok).toBe(true);

    const [review] = await database.select().from(reviews);
    expect(review).toMatchObject({ baseSha: null, changedFiles: [] });
    expect(await database.select().from(repositoryGraphs)).toEqual([]);
  });

  it("records changed files even when the index produced no snapshot", async () => {
    const { graph: _graph, ...noSnapshot } = withGraph;
    await ingestReviewRecord(database, organizationId, noSnapshot);

    const [review] = await database.select().from(reviews);
    expect(review).toMatchObject({ baseSha: snapshot.sha, changedFiles });
    expect(await database.select().from(repositoryGraphs)).toEqual([]);
  });

  it("keeps only the newest snapshots the retention rule allows", async () => {
    const stored = REPOSITORY_GRAPH_RETENTION + 2;
    for (let seed = 1; seed <= stored; seed += 1) {
      const built = snapshotAt(shaOf(seed));
      await ingestReviewRecord(database, organizationId, {
        ...withGraph,
        headSha: shaOf(seed + 1000),
        baseSha: built.sha,
        graph: graphOf(built),
      });
    }

    const rows = await database
      .select({ baseSha: repositoryGraphs.baseSha })
      .from(repositoryGraphs)
      .orderBy(asc(repositoryGraphs.id));
    expect(rows.map((row) => row.baseSha)).toEqual(
      Array.from({ length: REPOSITORY_GRAPH_RETENTION }, (_, offset) =>
        shaOf(stored - REPOSITORY_GRAPH_RETENTION + offset + 1),
      ),
    );
  });
});

const risk: ReviewRecordRisk = {
  score: 58,
  band: "medium",
  partial: false,
  factors: [
    { label: "41 files depend on this change", points: 31 },
    { label: "crosses 3 packages", points: 16 },
  ],
  hubs: [{ path: "src/auth/session.ts", dependents: 38 }],
  counts: {
    direct: 12,
    transitive: 41,
    entryPoints: 2,
    untested: 1,
    inCycle: 0,
    brokenImporters: 0,
  },
  packages: 3,
  dependents: ["src/api/login.ts", "src/api/logout.ts"],
};

describe("ingestReviewRecord, with a risk score", () => {
  it("stores the risk as it arrived", async () => {
    const result = await ingestReviewRecord(database, organizationId, { ...record, risk });
    expect(result.ok).toBe(true);

    const [review] = await database.select().from(reviews);
    expect(review?.risk).toEqual(risk);
  });

  it("stores no risk, as SQL null, for a sender that predates it", async () => {
    await ingestReviewRecord(database, organizationId, record);

    const [review] = await database.select().from(reviews);
    expect(review?.risk).toBeNull();
    const unscored = await database.select().from(reviews).where(isNull(reviews.risk));
    expect(unscored).toHaveLength(1);
  });

  it("replaces the risk on a rerun of the same head, and clears it when the rerun has none", async () => {
    await ingestReviewRecord(database, organizationId, { ...record, risk });
    const rescored: ReviewRecordRisk = {
      ...risk,
      score: 12,
      band: "low",
      factors: [{ label: "1 file depends on this change", points: 12 }],
      dependents: ["src/api/login.ts"],
    };
    await ingestReviewRecord(database, organizationId, { ...record, risk: rescored });

    const [rerun] = await database.select().from(reviews);
    expect(rerun?.risk).toEqual(rescored);

    await ingestReviewRecord(database, organizationId, record);
    const rows = await database.select().from(reviews);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.risk).toBeNull();
  });

  it("rejects an out-of-bounds risk by its path alone, and writes nothing", async () => {
    const outOfBounds = { ...record, risk: { ...risk, score: 150 } };

    await expect(ingestReviewRecord(database, organizationId, outOfBounds)).resolves.toEqual({
      ok: false,
      reason: "invalid-record",
      issues: ["risk.score"],
    });
    expect(await database.select().from(repos)).toEqual([]);
    expect(await database.select().from(reviews)).toEqual([]);
    expect(await database.select().from(findings)).toEqual([]);
  });

  it("names every failing path, with array indexes, and none of the values", async () => {
    const result = await ingestReviewRecord(database, organizationId, {
      ...record,
      risk: {
        ...risk,
        factors: [{ label: "fractional", points: 2.5 }],
        dependents: ["src/api/login.ts", ""],
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid-record",
      issues: ["risk.factors.0.points", "risk.dependents.1"],
    });
  });
});
