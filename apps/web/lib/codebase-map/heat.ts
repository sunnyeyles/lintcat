import type { Severity } from "@pr-review/schemas";

import {
  noFindings,
  type FindingCounts,
  type FindingHeat,
} from "@/lib/codebase-map/from-snapshot";
import { countLabel } from "@/lib/format";

/** How thick the ring is drawn, so the count reads without colour. */
const HEAT_BANDS = [1, 3, 6] as const;

export interface Heat {
  counts: FindingCounts;
  /** The worst severity present, so the ring never softens a high finding. */
  top: Severity | null;
  band: 0 | 1 | 2 | 3;
}

export const NO_HEAT: Heat = {
  counts: noFindings(),
  top: null,
  band: 0,
};

function bandOf(total: number): Heat["band"] {
  if (total >= HEAT_BANDS[2]) return 3;
  if (total >= HEAT_BANDS[1]) return 2;
  if (total >= HEAT_BANDS[0]) return 1;
  return 0;
}

export function heatOf(counts: FindingCounts | undefined): Heat {
  if (!counts || counts.total <= 0) return NO_HEAT;
  const top: Severity | null =
    counts.high > 0 ? "high" : counts.medium > 0 ? "medium" : counts.low > 0 ? "low" : null;
  return { counts, top, band: bandOf(counts.total) };
}

export function sumHeat(heat: FindingHeat, paths: readonly string[]): FindingCounts {
  const counts = noFindings();
  for (const path of paths) {
    const one = heat[path];
    if (!one) continue;
    counts.total += one.total;
    counts.high += one.high;
    counts.medium += one.medium;
    counts.low += one.low;
  }
  return counts;
}

/** Sums a group's files, so findings stay visible while the group is collapsed. */
export function heatOfPaths(heat: FindingHeat, paths: readonly string[]): Heat {
  return heatOf(sumHeat(heat, paths));
}

export function heatLabel(heat: Heat): string {
  if (heat.counts.total === 0) return "No findings";
  const parts = [
    heat.counts.high > 0 ? `${heat.counts.high} high` : null,
    heat.counts.medium > 0 ? `${heat.counts.medium} medium` : null,
    heat.counts.low > 0 ? `${heat.counts.low} low` : null,
  ].filter((part): part is string => part !== null);
  return `${countLabel(heat.counts.total, "finding")}: ${parts.join(", ")}`;
}
