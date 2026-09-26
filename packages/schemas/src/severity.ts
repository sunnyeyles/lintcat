/** Lowest first; the index is the rank. */
export const SEVERITIES = ["low", "medium", "high"] as const;

export type Severity = (typeof SEVERITIES)[number];

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

/** Ascending: lowest severity first. */
export function compareSeverity(a: Severity, b: Severity): number {
  return severityRank(a) - severityRank(b);
}

export function emptySeverityCounts(): Record<Severity, number> {
  return { low: 0, medium: 0, high: 0 };
}

/** Strongest first: severity, then confidence. Ties keep the caller's order. */
export function compareFindingStrength(
  a: { severity: Severity; confidence: number },
  b: { severity: Severity; confidence: number },
): number {
  return compareSeverity(b.severity, a.severity) || b.confidence - a.confidence;
}
