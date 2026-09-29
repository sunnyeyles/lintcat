// Only the high level is coloured, so colour on a badge always means "look here".
export const LEVEL_TONE = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "border-severity-high/40 bg-severity-high/15 text-severity-high",
} as const;
