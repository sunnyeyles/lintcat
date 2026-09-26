import type { ChartConfig } from "@pr-review/design/chart";
import type { Severity, TokenUsage } from "@pr-review/schemas";

export type SeriesDef<K extends string> = { key: K; label: string };

export const SEVERITY_SERIES: readonly SeriesDef<Severity>[] = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
];

// Severity has its own tokens rather than chart slots: it means urgency, not category.
export const SEVERITY_CONFIG = {
  low: { label: "Low", color: "var(--severity-low)" },
  medium: { label: "Medium", color: "var(--severity-medium)" },
  high: { label: "High", color: "var(--severity-high)" },
} satisfies ChartConfig;

export type TokenKey = keyof TokenUsage;

// Ordered cheapest to dearest per the price table, so loudness tracks unit price.
export const TOKEN_SERIES: readonly SeriesDef<TokenKey>[] = [
  { key: "cacheReadInputTokens", label: "Cache read" },
  { key: "inputTokens", label: "Input" },
  { key: "cacheCreationInputTokens", label: "Cache write" },
  { key: "outputTokens", label: "Output" },
];

export const TOKEN_CONFIG = {
  cacheReadInputTokens: { label: "Cache read", color: "var(--chart-3)" },
  inputTokens: { label: "Input", color: "var(--chart-2)" },
  cacheCreationInputTokens: { label: "Cache write", color: "var(--chart-4)" },
  outputTokens: { label: "Output", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function sumTokens(t: TokenUsage): number {
  return (
    t.inputTokens +
    t.cacheCreationInputTokens +
    t.cacheReadInputTokens +
    t.outputTokens
  );
}

export function formatAxisDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
