/**
 * The validation chain, in order: schema, category, changed file, added line,
 * confidence, evidence, dedupe, cap. Dedupe runs before the cap so it cannot waste cap slots.
 */
import type { ChangedFile } from "@pr-review/github";
import { reviewFindingSchema, type ReviewFinding } from "@pr-review/schemas";

import { buildChangedLineIndex } from "#src/diff-lines";
import {
  hasEnoughEvidence,
  withVerifiedEvidence,
  type EvidenceBase,
} from "#src/validate-evidence";

/** Findings with confidence below this threshold are dropped. */
export const CONFIDENCE_THRESHOLD = 0.7;

/** At most this many findings are published per review. */
export const MAX_FINDINGS = 10;

const severityRank: Record<ReviewFinding["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Orders findings strongest first: severity rank, then confidence, descending.
 * Ties keep the caller's order, since Array.prototype.sort is stable.
 */
export function compareFindingStrength(
  a: ReviewFinding,
  b: ReviewFinding,
): number {
  const severityDelta = severityRank[b.severity] - severityRank[a.severity];
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return b.confidence - a.confidence;
}

/** Titles compare on words alone, so punctuation and case cannot split a pair. */
export function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The two keys under which a finding can collide with an earlier one. */
function duplicateKeys(finding: ReviewFinding): [string, string] {
  return [
    `anchor:${finding.file} ${finding.line ?? "file-level"} ${finding.category}`,
    `title:${finding.file} ${normaliseTitle(finding.title)}`,
  ];
}

/** The validation step that dropped a candidate. */
export type RejectionStage =
  | "schema"
  | "category"
  | "not-in-diff"
  | "line-not-added"
  | "low-confidence"
  | "evidence"
  | "duplicate"
  | "over-cap";

/** Told about each dropped candidate, in chain order. */
export type OnRejected = (candidate: unknown, stage: RejectionStage) => void;

/**
 * Runs raw candidates through the validation chain, with no I/O; `onRejected` is its only effect.
 * Returns the survivors, strongest first.
 */
export function validateFindings(
  candidates: readonly unknown[],
  changedFiles: readonly ChangedFile[],
  allowedCategories: readonly string[],
  evidenceBase: EvidenceBase,
  onRejected: OnRejected = () => {},
): ReviewFinding[] {
  const keep = <T>(items: readonly T[], stage: RejectionStage, test: (item: T) => boolean) =>
    items.filter((item) => {
      if (test(item)) return true;
      onRejected(item, stage);
      return false;
    });

  // 1. Schema validity.
  const wellFormed = candidates.flatMap((candidate) => {
    const parsed = reviewFindingSchema.safeParse(candidate);
    if (!parsed.success) onRejected(candidate, "schema");
    return parsed.success ? [parsed.data] : [];
  });

  // 2. Category is one the run's agents own. The schema cannot check
  // this: the agent set is configurable and known only at runtime.
  const allowed = new Set(allowedCategories);
  const inCategory = keep(wellFormed, "category", (finding) => allowed.has(finding.category));

  // 3 + 4. File exists in the PR; line (when present) is an added line
  // in that file's diff.
  const changedLines = buildChangedLineIndex(changedFiles);
  const inDiff = keep(inCategory, "not-in-diff", (finding) => changedLines.has(finding.file));
  const anchored = keep(
    inDiff,
    "line-not-added",
    (finding) => finding.line === undefined || changedLines.get(finding.file)?.has(finding.line) === true,
  );

  // 5. Confidence threshold.
  const confident = keep(
    anchored,
    "low-confidence",
    (finding) => finding.confidence >= CONFIDENCE_THRESHOLD,
  );

  // 6. Evidence entries the base commit cannot vouch for are removed,
  // then a finding left without enough evidence goes with them.
  const evidenced = keep(
    confident.map((finding) => withVerifiedEvidence(finding, evidenceBase)),
    "evidence",
    hasEnoughEvidence,
  );

  // 7. Duplicate removal. Sorted first, so the strongest of each group
  // is the one that survives.
  const strongestFirst = [...evidenced].sort(compareFindingStrength);
  const seen = new Set<string>();
  const distinct = keep(strongestFirst, "duplicate", (finding) => {
    const keys = duplicateKeys(finding);
    if (keys.some((key) => seen.has(key))) return false;
    for (const key of keys) seen.add(key);
    return true;
  });

  // 8. Cap at MAX_FINDINGS, keeping the strongest.
  for (const finding of distinct.slice(MAX_FINDINGS)) onRejected(finding, "over-cap");
  return distinct.slice(0, MAX_FINDINGS);
}
