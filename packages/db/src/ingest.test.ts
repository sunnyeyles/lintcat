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
} from "@pr-review/schemas";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  findOrganizationByIngestToken,
  hashIngestToken,
  ingestReviewRecord,
} from "./ingest";
import {
  findRepositoryGraph,
  REPOSITORY_GRAPH_RETENTION,
} from "./repository-graphs";
import {
  agentRuns,
  findings,
  organizations,
  repos,
  repositoryGraphs,
  reviews,
} from "./schema";
import { createTestDatabase } from "./test-database";

const securityRun = {
  agent: "security",
  durationMs: 41_000,
  findingCount: 1,
  inputTokens: 12_000,
  cacheCreationInputTokens: 4_000,
  cacheReadInputTokens: 20_000,
  outputTokens: 800,
};

const performanceRun = {
  agent: "performance",
  durationMs: 30_000,
  findingCount: 1,
  inputTokens: 9_000,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 500,
};

const record: ReviewRecord = {
  owner: "acme",
  repo: "widgets",
  prNumber: 7,
  headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567",
  agents: ["security", "performance"],
  summary: "One high severity finding.",
  durationMs: 45_000,
  agentRuns: [securityRun, performanceRun],
  findings: [
    {
      agent: "security",
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
      ingestToken: hashIngestToken("secret-token"),
    })
    .returning({ id: organizations.id });
  organizationId = inserted[0]!.id;
});

describe("hashIngestToken", () => {
  it("is a stable sha-256 hex digest, not the secret", () => {
    const hash = hashIngestToken("secret-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("secret-token");
    expect(hashIngestToken("secret-token")).toBe(hash);
    expect(hashIngestToken("other-token")).not.toBe(hash);
  });
});

describe("findOrganizationByIngestToken", () => {
  it("finds the organization whose stored hash matches the secret", async () => {
    const organization = await findOrganizationByIngestToken(
      database,
      "secret-token",
    );
    expect(organization?.id).toBe(organizationId);
  });

  it("returns undefined for an unknown or empty token", async () => {
    expect(await findOrganizationByIngestToken(database, "nope")).toBeUndefined();
    expect(await findOrganizationByIngestToken(database, "")).toBeUndefined();
  });
});

describe("ingestReviewRecord", () => {
  it("creates the repo, the review, one agent run per agent and the findings", async () => {
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
      agents: ["security", "performance"],
      summary: "One high severity finding.",
      durationMs: 45_000,
    });

    const runRows = await database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.reviewId, result.reviewId))
      .orderBy(asc(agentRuns.agent));
    expect(runRows).toEqual([
      { id: expect.any(Number), reviewId: result.reviewId, ...performanceRun },
      { id: expect.any(Number), reviewId: result.reviewId, ...securityRun },
    ]);

    const findingRows = await database
      .select()
      .from(findings)
      .where(eq(findings.reviewId, result.reviewId))
      .orderBy(asc(findings.id));
    expect(findingRows).toHaveLength(2);
    expect(findingRows[0]).toMatchObject({
      agent: "security",
      file: "src/auth/session.ts",
      line: 84,
      category: "security",
      severity: "high",
      title: "Missing tenant validation",
      suggestedFix: "Filter by the authenticated tenant id.",
    });
    expect(findingRows[0]?.confidence).toBeCloseTo(0.9, 5);
    expect(findingRows[1]).toMatchObject({
      agent: null,
      line: null,
      suggestedFix: null,
      title: "Quadratic scan",
    });
  });

  it("updates rather than duplicates on a rerun of the same commit", async () => {
    const first = await ingestReviewRecord(database, organizationId, record);
    const rerun: ReviewRecord = {
      ...record,
      agents: ["performance"],
      summary: "Now only one finding.",
      durationMs: 30_000,
      agentRuns: [{ ...performanceRun, outputTokens: 400 }],
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

    const runRows = await database.select().from(agentRuns);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({ agent: "performance", outputTokens: 400 });

    const reviewRows = await database.select().from(reviews);
    expect(reviewRows[0]).toMatchObject({
      agents: ["performance"],
      summary: "Now only one finding.",
      durationMs: 30_000,
    });
  });

  it("keeps a different head sha as its own review", async () => {
    await ingestReviewRecord(database, organizationId, record);
    await ingestReviewRecord(database, organizationId, {
      ...record,
      headSha: "aaaabbbbccccddddeeeeffff00001111222233334",
    });
    expect(await database.select().from(reviews)).toHaveLength(2);
    expect(await database.select().from(agentRuns)).toHaveLength(4);
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

  it("treats an uninstalled organization as unknown, by id and by token", async () => {
    await database
      .update(organizations)
      .set({ uninstalledAt: new Date() })
      .where(eq(organizations.id, organizationId));
    expect(await findOrganizationByIngestToken(database, "secret-token")).toBeUndefined();
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
