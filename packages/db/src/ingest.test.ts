import type { ReviewRecord } from "@pr-review/schemas";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  findTeamByIngestToken,
  hashIngestToken,
  ingestReviewRecord,
} from "./ingest";
import { agentRuns, findings, repos, reviews, teams } from "./schema";
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
let teamId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const inserted = await database
    .insert(teams)
    .values({
      slug: "acme",
      name: "Acme",
      githubOrg: "acme",
      ingestToken: hashIngestToken("secret-token"),
    })
    .returning({ id: teams.id });
  teamId = inserted[0]!.id;
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

describe("findTeamByIngestToken", () => {
  it("finds the team whose stored hash matches the secret", async () => {
    const team = await findTeamByIngestToken(database, "secret-token");
    expect(team?.id).toBe(teamId);
  });

  it("returns undefined for an unknown or empty token", async () => {
    expect(await findTeamByIngestToken(database, "nope")).toBeUndefined();
    expect(await findTeamByIngestToken(database, "")).toBeUndefined();
  });
});

describe("ingestReviewRecord", () => {
  it("creates the repo, the review, one agent run per agent and the findings", async () => {
    const result = await ingestReviewRecord(database, teamId, record);
    expect(result).toEqual({ ok: true, reviewId: expect.any(Number) });
    if (!result.ok) return;

    const repoRows = await database.select().from(repos);
    expect(repoRows).toHaveLength(1);
    expect(repoRows[0]).toMatchObject({
      teamId,
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
    const first = await ingestReviewRecord(database, teamId, record);
    const rerun: ReviewRecord = {
      ...record,
      agents: ["performance"],
      summary: "Now only one finding.",
      durationMs: 30_000,
      agentRuns: [{ ...performanceRun, outputTokens: 400 }],
      findings: [record.findings[1]!],
    };
    const second = await ingestReviewRecord(database, teamId, rerun);

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
    await ingestReviewRecord(database, teamId, record);
    await ingestReviewRecord(database, teamId, {
      ...record,
      headSha: "aaaabbbbccccddddeeeeffff00001111222233334",
    });
    expect(await database.select().from(reviews)).toHaveLength(2);
    expect(await database.select().from(agentRuns)).toHaveLength(4);
    expect(await database.select().from(repos)).toHaveLength(1);
  });

  it("reports owner-mismatch when the owner is not the team's github org", async () => {
    const result = await ingestReviewRecord(database, teamId, {
      ...record,
      owner: "someone-else",
    });
    expect(result).toEqual({ ok: false, reason: "owner-mismatch" });
    expect(await database.select().from(repos)).toHaveLength(0);
  });

  it("matches the github org case-insensitively", async () => {
    const result = await ingestReviewRecord(database, teamId, {
      ...record,
      owner: "AcMe",
    });
    expect(result.ok).toBe(true);
  });

  it("reports owner-mismatch when the team has no github org", async () => {
    const inserted = await database
      .insert(teams)
      .values({ slug: "orgless", name: "Orgless" })
      .returning({ id: teams.id });
    const result = await ingestReviewRecord(database, inserted[0]!.id, record);
    expect(result).toEqual({ ok: false, reason: "owner-mismatch" });
  });

  it("reports team-not-found for an unknown team", async () => {
    const result = await ingestReviewRecord(database, teamId + 999, record);
    expect(result).toEqual({ ok: false, reason: "team-not-found" });
  });
});
