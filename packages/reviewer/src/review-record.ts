/** The dashboard's record of one finished run, shaped so the schema always accepts it. */
import {
  encodeRepositoryGraph,
  type ChangeOverlay,
  type RepositoryGraphSnapshot,
} from "@pr-review/index";
import type { StructuredLogger } from "@pr-review/logging";
import {
  MAX_RISK_DEPENDENTS,
  MAX_RISK_FACTORS,
  MAX_RISK_HUBS,
  reviewRecordSchema,
  type ReviewRecord,
  type ReviewRecordGraph,
  type ReviewRecordOverlay,
  type ReviewRecordRisk,
} from "@pr-review/schemas";

import { changeStatus, type BlastRadius } from "#src/blast-radius";
import type { FinishedReviewRun } from "#src/review-delivery";
import { reviewCorrelation, type ReviewTarget } from "#src/review-target";

type OptionalSection = "baseSha" | "changedFiles" | "graph" | "risk" | "overlay";

function graphPayload(snapshot: RepositoryGraphSnapshot): ReviewRecordGraph {
  return {
    gzip: Buffer.from(encodeRepositoryGraph(snapshot)).toString("base64"),
    fileCount: snapshot.files.length,
    edgeCount: snapshot.edges.length,
  };
}

// Field by field, so nothing the impact grows later leaves without a decision.
function riskPayload({ impact, risk }: BlastRadius): ReviewRecordRisk {
  const { counts } = impact;
  return {
    score: risk.score,
    band: risk.band,
    partial: risk.partial,
    factors: risk.factors
      .slice(0, MAX_RISK_FACTORS)
      .map(({ label, points }) => ({ label, points })),
    hubs: impact.hubs
      .slice(0, MAX_RISK_HUBS)
      .map(({ path, dependents }) => ({ path, dependents })),
    counts: {
      direct: counts.direct,
      transitive: counts.transitive,
      entryPoints: counts.entryPoints,
      untested: counts.untested,
      inCycle: counts.inCycle,
      brokenImporters: counts.brokenImporters,
    },
    packages: impact.packages.length,
    dependents: impact.transitive.slice(0, MAX_RISK_DEPENDENTS),
  };
}

function overlayPayload(overlay: ChangeOverlay): ReviewRecordOverlay {
  return {
    headSha: overlay.headSha,
    files: overlay.files.map(({ path, status, previousPath }) => ({
      path,
      status,
      ...(previousPath === undefined ? {} : { previousPath }),
    })),
    added: overlay.added.map(({ from, to }) => ({ from, to })),
    removed: overlay.removed.map(({ from, to }) => ({ from, to })),
    unresolvedImportCount: overlay.unresolvedImportCount,
    partial: overlay.partial,
  };
}

/**
 * Required fields go out as they are, so ingest rejects a bad one loudly; an
 * optional section the schema would reject is dropped alone, with a log line.
 */
export function buildReviewRecord(
  target: ReviewTarget,
  { outcome, usage, durationMs }: FinishedReviewRun,
  logger: StructuredLogger,
): ReviewRecord {
  const dropped = (section: OptionalSection, issues: string[]): undefined => {
    logger.error("review_record.section_dropped", {
      ...reviewCorrelation(target),
      section,
      issues,
    });
    return undefined;
  };
  const checked = <K extends OptionalSection>(
    section: K,
    value: ReviewRecord[K],
  ): ReviewRecord[K] => {
    if (value === undefined) return undefined;
    const parsed = reviewRecordSchema.shape[section].safeParse(value);
    if (parsed.success) return value;
    // Paths only: a failing value can be a repository file path.
    return dropped(
      section,
      parsed.error.issues.map((issue) => [section, ...issue.path].join(".")),
    );
  };

  const count = outcome.findings.length;
  const baseSha = checked("baseSha", outcome.baseSha);
  const changedFiles = checked(
    "changedFiles",
    outcome.changedFiles.map((file) => ({
      path: file.filename,
      status: changeStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
      ...(file.previous_filename === undefined
        ? {}
        : { previousPath: file.previous_filename }),
    })),
  );
  let graph = checked(
    "graph",
    outcome.graph === undefined ? undefined : graphPayload(outcome.graph),
  );
  if (graph !== undefined && baseSha === undefined) {
    graph = dropped("graph", ["baseSha"]);
  }
  const risk = checked(
    "risk",
    outcome.blastRadius === undefined
      ? undefined
      : riskPayload(outcome.blastRadius),
  );
  const overlay = checked(
    "overlay",
    outcome.overlay === undefined ? undefined : overlayPayload(outcome.overlay),
  );
  return {
    owner: target.owner,
    repo: target.repo,
    prNumber: target.pullRequestNumber,
    headSha: target.headSha,
    summary: count === 1 ? "1 finding" : `${count} findings`,
    durationMs,
    ...(baseSha === undefined ? {} : { baseSha }),
    ...(changedFiles === undefined ? {} : { changedFiles }),
    ...(graph === undefined ? {} : { graph }),
    ...(risk === undefined ? {} : { risk }),
    ...(overlay === undefined ? {} : { overlay }),
    ...usage,
    // The patch is verbatim source, so the dashboard learns only that one survived.
    findings: outcome.findings.map(({ patch, ...finding }) => ({
      ...finding,
      hasPatch: patch !== undefined,
    })),
  };
}
