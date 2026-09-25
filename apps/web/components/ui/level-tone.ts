// One tone per level, so a high risk band reads as loud as a high finding.
export const LEVEL_TONE = {
  low: "border-severity-low/40 bg-severity-low/10 text-severity-low",
  medium: "border-severity-medium/40 bg-severity-medium/10 text-severity-medium",
  high: "border-severity-high/40 bg-severity-high/15 text-severity-high",
} as const;
