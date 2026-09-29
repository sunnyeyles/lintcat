/** Checks a finding's evidence against the repository at the pull request's base. */
import {
  conventionCounts,
  conventionSentence,
  isRuleDoc,
  type ConventionCount,
  type RepositoryIndex,
} from "@pr-review/index";
import {
  isConventionCount,
  type ConventionCountEvidence,
  type FindingEvidence,
  type ReviewFinding,
} from "@pr-review/schemas";

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

/** The count the opening message showed for this entry; only a changed file's siblings are counted. */
function countFor(
  entry: ConventionCountEvidence,
  base: EvidenceBase,
): ConventionCount | undefined {
  if (base.index === undefined || !base.changedPaths.has(entry.file)) {
    return undefined;
  }
  return conventionCounts(base.index, entry.file, base.changedPaths).find(
    (count) => count.convention === entry.convention,
  );
}

/** Why an entry cannot stand as evidence, or undefined when it can. */
export function evidenceProblem(
  entry: Exclude<FindingEvidence, ConventionCountEvidence>,
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

/** The entry as it may stand, a count's summary rewritten from the index. */
function verifiedEntry(entry: FindingEvidence, base: EvidenceBase): FindingEvidence | undefined {
  if (!isConventionCount(entry)) {
    return evidenceProblem(entry, base) === undefined ? entry : undefined;
  }
  const count = countFor(entry, base);
  if (count === undefined) {
    return undefined;
  }
  const summary = conventionSentence(count, `siblings of ${entry.file}`);
  return { convention: entry.convention, file: entry.file, summary };
}

function evidenceKey(entry: FindingEvidence): string {
  return isConventionCount(entry)
    ? `${entry.convention} count for ${entry.file}`
    : `${entry.file}:${entry.line}`;
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
    const key = evidenceKey(entry);
    const verified = seen.has(key) ? undefined : verifiedEntry(entry, base);
    if (verified === undefined) {
      continue;
    }
    seen.add(key);
    kept.push(verified);
  }
  const { evidence: _dropped, ...rest } = finding;
  return kept.length === 0 ? rest : { ...rest, evidence: kept.slice(0, MAX_EVIDENCE) };
}

/** A rule-doc line states the convention and a count stands for three agreeing files: either is enough alone. */
export function hasEnoughEvidence(finding: ReviewFinding): boolean {
  const evidence = finding.evidence ?? [];
  return (
    evidence.length >= MIN_EVIDENCE ||
    evidence.some((entry) => isConventionCount(entry) || isRuleDoc(entry.file))
  );
}
