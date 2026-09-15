import type { Finding } from "@pr-review/db";

import type { Severity } from "@/lib/data";

export const SEVERITIES: readonly Severity[] = ["high", "medium", "low"];

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function bySeverityThenConfidence(a: Finding, b: Finding): number {
  const rank = RANK[a.severity] - RANK[b.severity];
  return rank !== 0 ? rank : b.confidence - a.confidence;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(bySeverityThenConfidence);
}

export function categoriesOf(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((f) => f.category))].sort();
}
