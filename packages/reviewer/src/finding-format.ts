/**
 * How a finding reads once it leaves the pipeline. Shared so the check
 * run and the review describe a finding identically.
 */
import { blobUrl, type CommitRef } from "@pr-review/github/links";
import {
  categoryLabel,
  evidenceLabel,
  isConventionCount,
  type FindingEvidence,
  type ReviewFinding,
} from "@pr-review/schemas";

/** The commit evidence links point at: the one validation checked it against. */
export type EvidenceSource = CommitRef;

/** `file` alone, or `file:line` when the finding is line-anchored. */
function location(finding: ReviewFinding): string {
  return finding.line === undefined
    ? finding.file
    : `${finding.file}:${finding.line}`;
}

/** The finding's heading: severity, category, and title. */
export function heading(finding: ReviewFinding): string {
  return `${finding.severity.toUpperCase()} — ${categoryLabel(finding.category)}: ${finding.title}`;
}

function evidenceLink(entry: FindingEvidence, source: EvidenceSource | undefined): string {
  if (isConventionCount(entry)) {
    return evidenceLabel(entry);
  }
  const label = `\`${entry.file}:${entry.line}\``;
  if (source === undefined) {
    return label;
  }
  return `[${label}](${blobUrl(source, entry.file, entry.line)})`;
}

/** The "Convention seen in" line, or undefined when no evidence survived. */
export function evidenceNote(
  finding: ReviewFinding,
  source: EvidenceSource | undefined,
): string | undefined {
  const { evidence } = finding;
  if (evidence === undefined || evidence.length === 0) {
    return undefined;
  }
  return `**Convention seen in:** ${evidence.map((entry) => evidenceLink(entry, source)).join(", ")}`;
}

/** A finding as a standalone Markdown block, location included. */
export function summarise(
  finding: ReviewFinding,
  source?: EvidenceSource | undefined,
): string {
  const lines = [
    `### ${heading(finding)}`,
    "",
    `\`${location(finding)}\``,
    "",
    finding.explanation,
  ];
  const evidence = evidenceNote(finding, source);
  if (evidence !== undefined) {
    lines.push("", evidence);
  }
  if (finding.suggestedFix !== undefined) {
    lines.push("", `**Suggested fix:** ${finding.suggestedFix}`);
  }
  return lines.join("\n");
}

/** "1 fix" / "3 fixes", which countLabel's added "s" cannot spell. */
export function fixCount(count: number): string {
  return count === 1 ? "1 fix" : `${count} fixes`;
}

/** "1 finding" / "3 agents". Pluralised by adding an "s". */
export function countLabel(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
