/**
 * How a finding reads once it leaves the pipeline. Shared so the check
 * run and the review describe a finding identically.
 */
import {
  categoryLabel,
  countLabel,
  findingLocation,
  type ReviewFinding,
} from "@pr-review/schemas";

export { countLabel };

/** The finding's heading: severity, category, and title. */
export function heading(finding: ReviewFinding): string {
  return `${finding.severity.toUpperCase()} — ${categoryLabel(finding.category)}: ${finding.title}`;
}

/** A finding as a standalone Markdown block, location included. */
export function summarise(finding: ReviewFinding): string {
  const lines = [
    `### ${heading(finding)}`,
    "",
    `\`${findingLocation(finding)}\``,
    "",
    finding.explanation,
  ];
  if (finding.suggestedFix !== undefined) {
    lines.push("", `**Suggested fix:** ${finding.suggestedFix}`);
  }
  return lines.join("\n");
}

export function fixCount(count: number): string {
  return countLabel(count, "fix", "fixes");
}
