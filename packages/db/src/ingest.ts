import type { ReviewRecord } from "@pr-review/schemas";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./client";
import { saveRepositoryGraph } from "./repository-graphs";
import {
  findings,
  repos,
  reviews,
  organizations,
  type Organization,
} from "./schema";

export type IngestFailure = "organization-not-found" | "owner-mismatch" | "repo-removed";

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
  if (repoId === undefined) return { ok: false, reason: "repo-removed" };
  const reviewId = await upsertReview(database, repoId, record);
  await replaceFindings(database, reviewId, record);
  if (record.graph !== undefined && record.baseSha !== undefined) {
    await saveRepositoryGraph(database, repoId, record.baseSha, record.graph);
  }
  return { ok: true, reviewId };
}

async function findOrganization(
  database: Database,
  organizationId: number,
): Promise<Organization | undefined> {
  const rows = await database
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.uninstalledAt)))
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
): Promise<number | undefined> {
  const found = await selectRepo(database, organizationId, record);
  if (found) return found.removedAt ? undefined : found.id;

  const inserted = await database
    .insert(repos)
    .values({ organizationId, owner: record.owner, name: record.repo })
    .onConflictDoNothing()
    .returning({ id: repos.id });
  const created = inserted[0];
  if (created) return created.id;

  // No row back means a concurrent first review for this repo won the insert.
  const winner = await selectRepo(database, organizationId, record);
  if (!winner) {
    throw new Error(`could not create repo ${record.owner}/${record.repo}`);
  }
  return winner.removedAt ? undefined : winner.id;
}

async function selectRepo(
  database: Database,
  organizationId: number,
  record: ReviewRecord,
): Promise<{ id: number; removedAt: Date | null } | undefined> {
  const rows = await database
    .select({ id: repos.id, removedAt: repos.removedAt })
    .from(repos)
    .where(
      and(
        eq(repos.organizationId, organizationId),
        eq(repos.owner, record.owner),
        eq(repos.name, record.repo),
      ),
    )
    .limit(1);
  return rows[0];
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
    baseSha: record.baseSha ?? null,
    changedFiles: record.changedFiles ?? [],
    summary: record.summary,
    durationMs: record.durationMs,
    inputTokens: record.inputTokens,
    cacheCreationInputTokens: record.cacheCreationInputTokens,
    cacheReadInputTokens: record.cacheReadInputTokens,
    outputTokens: record.outputTokens,
    risk: record.risk ?? null,
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
