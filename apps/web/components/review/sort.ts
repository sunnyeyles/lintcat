import type { Finding } from "@pr-review/db";

import type { Severity } from "@pr-review/db/dashboard";

export const SEVERITIES: readonly Severity[] = ["high", "medium", "low"];

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function bySeverityThenConfidence(a: Finding, b: Finding): number {
  const rank = RANK[a.severity] - RANK[b.severity];
  return rank !== 0 ? rank : b.confidence - a.confidence;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(bySeverityThenConfidence);
}
