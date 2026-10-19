/** Writes a finished hosted run straight to the database, through the ingest write path. */
import { ingestReviewRecord, type Database } from "@pr-review/db";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { reviewCorrelation, type PublishToDashboard } from "@pr-review/reviewer";

// Non-generic so a `vi.fn` runner fits; callers log inside `run` rather than return through it.
export type WriteDatabaseRunner = (run: (database: Database) => Promise<void>) => Promise<unknown>;

/** Never throws: a review already published to GitHub must not fail on this step. */
export function createDatabaseReviewPublisher(
  withWriteDatabase: WriteDatabaseRunner,
  organizationId: number,
  logger: StructuredLogger,
): PublishToDashboard {
  return async (target, record) => {
    try {
      await withWriteDatabase(async (database) => {
        const result = await ingestReviewRecord(database, organizationId, record);
        if (result.ok) {
          logger.info("review_job.recorded", { ...reviewCorrelation(target), reviewId: result.reviewId });
        } else if (result.reason === "invalid-record") {
          logger.error("review_job.record_invalid", {
            ...reviewCorrelation(target),
            issues: result.issues,
          });
        } else {
          logger.error("review_job.record_failed", {
            ...reviewCorrelation(target),
            reason: result.reason,
          });
        }
      });
    } catch (error) {
      logger.error("review_job.record_failed", {
        ...reviewCorrelation(target),
        error: errorMessage(error),
      });
    }
  };
}
