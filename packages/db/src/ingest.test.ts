import type { ReviewRecord } from "@pr-review/schemas";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  findOrganizationByIngestToken,
  hashIngestToken,
  ingestReviewRecord,
} from "./ingest";
import { findings, organizations, repos, reviews } from "./schema";
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
