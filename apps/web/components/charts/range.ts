import type { Range } from "@pr-review/db/dashboard";

export const RANGES: readonly Range[] = ["7d", "30d", "90d"];

export const RANGE_LABEL: Record<Range, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

export const RANGE_PHRASE: Record<Range, string> = {
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
};

const DEFAULT_RANGE: Range = "30d";

export function parseRange(value: string | string[] | undefined): Range {
  const first = Array.isArray(value) ? value[0] : value;
  return RANGES.find((range) => range === first) ?? DEFAULT_RANGE;
}
