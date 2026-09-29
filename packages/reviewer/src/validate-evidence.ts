/** Checks a finding's evidence against the repository at the pull request's base. */
import type { RepositoryIndex } from "@pr-review/index";
import type { FindingEvidence, ReviewFinding } from "@pr-review/schemas";

/** Entries kept per finding once the invalid ones are gone. */
export const MAX_EVIDENCE = 5;

/** Valid entries a finding needs to stand: a convention seen once is not one. */
export const MIN_EVIDENCE = 2;

/** What an evidence entry is checked against. */
export interface EvidenceBase {
  /** Without one, only the changed-file rule can be applied. */
  index: RepositoryIndex | undefined;
  /** Every path the whole pull request touches, renames on both sides. */
  changedPaths: ReadonlySet<string>;
}

/** Why an entry cannot stand as evidence, or undefined when it can. */
export function evidenceProblem(
  entry: FindingEvidence,
  base: EvidenceBase,
): "changed-file" | "missing-file" | "line-out-of-range" | undefined {
  if (base.changedPaths.has(entry.file)) {
    return "changed-file";
  }
  if (base.index === undefined) {
    return undefined;
  }
  const indexed = base.index.files.get(entry.file);
  if (indexed === undefined) {
    return "missing-file";
  }
  return entry.line > indexed.lineCount ? "line-out-of-range" : undefined;
}

/** The finding with only its checkable, distinct evidence, capped at MAX_EVIDENCE. */
export function withVerifiedEvidence(
  finding: ReviewFinding,
  base: EvidenceBase,
): ReviewFinding {
  if (finding.evidence === undefined) {
    return finding;
  }
  const seen = new Set<string>();
  const kept: FindingEvidence[] = [];
  for (const entry of finding.evidence) {
    const key = `${entry.file}:${entry.line}`;
    if (seen.has(key) || evidenceProblem(entry, base) !== undefined) {
      continue;
    }
    seen.add(key);
    kept.push(entry);
  }
  const { evidence: _dropped, ...rest } = finding;
  return kept.length === 0 ? rest : { ...rest, evidence: kept.slice(0, MAX_EVIDENCE) };
}

export function hasEnoughEvidence(finding: ReviewFinding): boolean {
  return (finding.evidence?.length ?? 0) >= MIN_EVIDENCE;
}
