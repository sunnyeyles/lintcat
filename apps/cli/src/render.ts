/** How a validated finding reads in a terminal: one location per finding. */
import {
  categoryLabel,
  compareSeverity,
  findingLocation,
  severityRank,
  SEVERITIES,
  type ReviewFinding,
  type Severity,
} from "@pr-review/schemas";

import type { FailOn } from "#src/options";

const COLOURS: Record<Severity, string> = {
  low: "\u001b[36m",
  medium: "\u001b[33m",
  high: "\u001b[31m",
};

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const WIDTH = 88;

export interface RenderOptions {
  color: boolean;
}

/** Greedy wrap at `WIDTH` columns, including the indent; a long word overhangs. */
export function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line !== "" && indent.length + line.length + 1 + word.length > WIDTH) {
        lines.push(indent + line);
        line = word;
      } else {
        line = line === "" ? word : `${line} ${word}`;
      }
    }
    if (line !== "") lines.push(indent + line);
  }
  return lines;
}

function paint(text: string, colour: string, options: RenderOptions): string {
  return options.color ? `${colour}${text}${RESET}` : text;
}

/** One finding: a severity-led header line, then its title, reason and fix. */
export function renderFinding(finding: ReviewFinding, options: RenderOptions): string {
  const severity = finding.severity;
  const header = [
    paint(severity.toUpperCase().padEnd(6), COLOURS[severity] + BOLD, options),
    paint(categoryLabel(finding.category), DIM, options),
    findingLocation(finding),
  ].join(" ");
  const lines = [header, ...wrap(finding.title, "  "), ...wrap(finding.explanation, "  ")];
  if (finding.suggestedFix !== undefined) {
    lines.push(...wrap(`Fix: ${finding.suggestedFix}`, "  "));
  }
  return lines.join("\n");
}

/** Highest severity first, then by file and line, so the blockers lead. */
export function orderFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((left, right) => {
    const bySeverity = compareSeverity(right.severity, left.severity);
    if (bySeverity !== 0) return bySeverity;
    return left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0);
  });
}

/** The findings a `--fail-on` threshold blocks on; "off" blocks on none. */
export function blockingFindings(
  findings: readonly ReviewFinding[],
  failOn: FailOn,
): ReviewFinding[] {
  if (failOn === "off") return [];
  const threshold = severityRank(failOn);
  return findings.filter((finding) => severityRank(finding.severity) >= threshold);
}

function counts(findings: readonly ReviewFinding[]): string {
  return [...SEVERITIES]
    .reverse()
    .map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length }))
    .filter(({ count }) => count > 0)
    .map(({ severity, count }) => `${count} ${severity}`)
    .join(", ");
}

export interface ReportSummary {
  findings: readonly ReviewFinding[];
  blocking: readonly ReviewFinding[];
  failOn: FailOn;
  /** Findings this checkout's review memory hid. */
  suppressed: number;
}

/** The last lines of a review: what was found, and whether it blocks. */
export function renderSummary(summary: ReportSummary, options: RenderOptions): string {
  const { findings, blocking, failOn, suppressed } = summary;
  const lines: string[] = [];
  if (suppressed > 0) {
    lines.push(`${suppressed} finding(s) hidden by this checkout's suppressions.`);
  }
  lines.push(
    findings.length === 0
      ? paint("No findings.", DIM, options)
      : `${findings.length} finding(s): ${counts(findings)}.`,
  );
  if (blocking.length > 0) {
    lines.push(
      paint(`Blocked: ${blocking.length} finding(s) at or above ${failOn}.`, COLOURS.high + BOLD, options),
    );
  }
  return lines.join("\n");
}
