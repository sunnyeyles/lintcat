/** What a review's codebase map needs beyond the shared base graph. Unscoped: check access first. */
import type {
  ReviewRecordChangedFile,
  ReviewRecordOverlay,
} from "@pr-review/schemas";
import { asc, eq } from "drizzle-orm";

import type { Database } from "./client";
import type { Severity } from "./dashboard/types";
import { findings, reviews } from "./schema";

export interface ReviewMapInputs {
  changedFiles: ReviewRecordChangedFile[];
  /** Null for a review stored before overlays, or one whose overlay failed. */
  overlay: ReviewRecordOverlay | null;
  dependents: string[];
  findings: { file: string; severity: Severity }[];
}

export async function findReviewMapInputs(
  database: Database,
  reviewId: number,
): Promise<ReviewMapInputs | undefined> {
  const [rows, found] = await Promise.all([
    database
      .select({
        changedFiles: reviews.changedFiles,
        overlay: reviews.overlay,
        risk: reviews.risk,
      })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1),
    database
      .select({ file: findings.file, severity: findings.severity })
      .from(findings)
      .where(eq(findings.reviewId, reviewId))
      .orderBy(asc(findings.id)),
  ]);
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    changedFiles: row.changedFiles,
    overlay: row.overlay ?? null,
    dependents: row.risk?.dependents ?? [],
    findings: found,
  };
}
