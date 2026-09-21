/**
 * How a finding reads once it leaves the pipeline. Shared so the check
 * run and the review describe a finding identically.
 */
import { categoryLabel, type ReviewFinding } from "@pr-review/schemas";

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

/** A finding as a standalone Markdown block, location included. */
export function summarise(finding: ReviewFinding): string {
  const lines = [
    `### ${heading(finding)}`,
    "",
    `\`${location(finding)}\``,
    "",
    finding.explanation,
  ];
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
