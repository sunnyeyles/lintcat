import { createHash } from "node:crypto";
import type { ReviewRecord } from "@pr-review/schemas";
import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import {
  agentRuns,
  findings,
  repos,
  reviews,
  organizations,
  type Organization,
} from "./schema";

/** What `organizations.ingestToken` stores; the secret itself is never persisted. */
export function hashIngestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function findOrganizationByIngestToken(
  database: Database,
  token: string,
): Promise<Organization | undefined> {
  if (!token) return undefined;
  const rows = await database
    .select()
    .from(organizations)
    .where(eq(organizations.ingestToken, hashIngestToken(token)))
    .limit(1);
  return rows[0];
}

/** `owner-mismatch` is the 404: the record's repo belongs to another account. */
export type IngestFailure = "organization-not-found" | "owner-mismatch";

export type IngestResult =
  | { ok: true; reviewId: number }
  | { ok: false; reason: IngestFailure };

export async function ingestReviewRecord(
  database: Database,
  organizationId: number,
  record: ReviewRecord,
): Promise<IngestResult> {
  const organization = await findOrganization(database, organizationId);
  if (!organization) return { ok: false, reason: "organization-not-found" };
  if (!ownsRepo(organization, record.owner)) {
    return { ok: false, reason: "owner-mismatch" };
  }

  const repoId = await findOrCreateRepo(database, organizationId, record);
  const reviewId = await upsertReview(database, repoId, record);
  await replaceAgentRuns(database, reviewId, record);
  await replaceFindings(database, reviewId, record);
  return { ok: true, reviewId };
}

async function findOrganization(
  database: Database,
  organizationId: number,
): Promise<Organization | undefined> {
  const rows = await database
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return rows[0];
}

// The slug is the lowercased GitHub login, and logins are case-insensitive.
function ownsRepo(organization: Organization, owner: string): boolean {
  return organization.slug === owner.toLowerCase();
}

async function findOrCreateRepo(
  database: Database,
  organizationId: number,
  record: ReviewRecord,
): Promise<number> {
  const found = await selectRepoId(database, organizationId, record);
  if (found !== undefined) return found;

  const inserted = await database
    .insert(repos)
    .values({ organizationId, owner: record.owner, name: record.repo })
    .onConflictDoNothing()
    .returning({ id: repos.id });
  const created = inserted[0];
  if (created) return created.id;

  // No row back means a concurrent first review for this repo won the insert.
  const winner = await selectRepoId(database, organizationId, record);
  if (winner === undefined) {
    throw new Error(`could not create repo ${record.owner}/${record.repo}`);
  }
  return winner;
}

async function selectRepoId(
  database: Database,
  organizationId: number,
  record: ReviewRecord,
): Promise<number | undefined> {
  const rows = await database
    .select({ id: repos.id })
    .from(repos)
    .where(
      and(
        eq(repos.organizationId, organizationId),
        eq(repos.owner, record.owner),
        eq(repos.name, record.repo),
      ),
    )
    .limit(1);
  return rows[0]?.id;
}

async function upsertReview(
  database: Database,
  repoId: number,
  record: ReviewRecord,
): Promise<number> {
  const values = {
    repoId,
    prNumber: record.prNumber,
    headSha: record.headSha,
    agents: record.agents,
    summary: record.summary,
    durationMs: record.durationMs,
  };
  const rows = await database
    .insert(reviews)
    .values(values)
    .onConflictDoUpdate({
      target: [reviews.repoId, reviews.prNumber, reviews.headSha],
      // createdAt moves to the rerun, so charts date the review by its last run.
      set: { ...values, createdAt: new Date() },
    })
    .returning({ id: reviews.id });
  const row = rows[0];
  if (!row) throw new Error("review upsert returned no row");
  return row.id;
}

async function replaceAgentRuns(
  database: Database,
  reviewId: number,
  record: ReviewRecord,
): Promise<void> {
  await database.delete(agentRuns).where(eq(agentRuns.reviewId, reviewId));
  if (record.agentRuns.length === 0) return;
  await database
    .insert(agentRuns)
    .values(record.agentRuns.map((run) => ({ reviewId, ...run })));
}

async function replaceFindings(
  database: Database,
  reviewId: number,
  record: ReviewRecord,
): Promise<void> {
  await database.delete(findings).where(eq(findings.reviewId, reviewId));
  if (record.findings.length === 0) return;
  await database.insert(findings).values(
    record.findings.map((finding) => ({
      reviewId,
      agent: finding.agent ?? null,
      file: finding.file,
      line: finding.line ?? null,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      explanation: finding.explanation,
      suggestedFix: finding.suggestedFix ?? null,
      confidence: finding.confidence,
    })),
  );
}
