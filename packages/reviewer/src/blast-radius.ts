/** A review's blast radius and risk score. Never throws: it only adds to a review. */
import { reviewCorrelation, type ChangedFile } from "@pr-review/github";
import {
  computeImpact,
  type Impact,
  type ImpactChange,
  type RepositoryIndex,
} from "@pr-review/index";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { CHANGE_STATUSES } from "@pr-review/schemas";

import type { ReviewTarget } from "#src/review-target";
import { scoreRisk, type RiskScore } from "#src/risk-score";

export interface BlastRadius {
  readonly impact: Impact;
  readonly risk: RiskScore;
}

const KNOWN_STATUSES = new Set<string>(CHANGE_STATUSES);

// GitHub's copied, changed and unchanged have no status of their own here.
export function changeStatus(status: string): ImpactChange["status"] {
  return KNOWN_STATUSES.has(status)
    ? (status as ImpactChange["status"])
    : "modified";
}

export function impactChanges(
  changedFiles: readonly ChangedFile[],
): ImpactChange[] {
  return changedFiles.map((file) => ({
    path: file.filename,
    status: changeStatus(file.status),
    ...(file.previous_filename === undefined
      ? {}
      : { previousPath: file.previous_filename }),
  }));
}

interface BlastRadiusRequest {
  index: RepositoryIndex | undefined;
  /** Every file the pull request changed, not just an incremental scope. */
  changedFiles: readonly ChangedFile[];
  target: ReviewTarget;
  logger: StructuredLogger;
}

/** undefined without an index, or when scoring fails. */
export function assessBlastRadius({
  index,
  changedFiles,
  target,
  logger,
}: BlastRadiusRequest): BlastRadius | undefined {
  if (index === undefined) {
    return undefined;
  }
  const fields = reviewCorrelation(target);
  const startedAt = Date.now();
  try {
    const impact = computeImpact(index, impactChanges(changedFiles));
    const risk = scoreRisk(impact);
    logger.info("risk.scored", {
      ...fields,
      score: risk.score,
      band: risk.band,
      partial: risk.partial,
      durationMs: Date.now() - startedAt,
    });
    return { impact, risk };
  } catch (error) {
    logger.error("risk.failed", {
      ...fields,
      reason: errorMessage(error),
      durationMs: Date.now() - startedAt,
      fallback: "publishing without the blast radius",
    });
    return undefined;
  }
}
