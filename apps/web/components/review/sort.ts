import type { Finding } from "@pr-review/db";
import { compareFindingStrength, SEVERITIES as ASCENDING, type Severity } from "@pr-review/schemas";

/** Highest first, the order the review page lists them in. */
export const SEVERITIES: readonly Severity[] = [...ASCENDING].reverse();

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindingStrength);
}
