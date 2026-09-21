import type { ChartConfig } from "@pr-review/design/chart";
import type { AgentName, Severity, TokenCounts } from "@pr-review/db/dashboard";

export type SeriesDef<K extends string> = { key: K; label: string };

export const SEVERITY_SERIES: readonly SeriesDef<Severity>[] = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
];

// High severity takes destructive rather than a chart slot: it means danger, not category.
export const SEVERITY_CONFIG = {
  low: { label: "Low", color: "var(--chart-2)" },
  medium: { label: "Medium", color: "var(--chart-4)" },
  high: { label: "High", color: "var(--destructive)" },
} satisfies ChartConfig;

const AGENT_SERIES: readonly SeriesDef<AgentName>[] = [
  { key: "security", label: "Security" },
  { key: "correctness", label: "Correctness" },
  { key: "performance", label: "Performance" },
  { key: "test-coverage", label: "Test coverage" },
  { key: "docs-drift", label: "Docs drift" },
];

export const AGENT_CONFIG = {
  security: { label: "Security", color: "var(--chart-1)" },
  correctness: { label: "Correctness", color: "var(--chart-2)" },
  performance: { label: "Performance", color: "var(--chart-3)" },
  "test-coverage": { label: "Test coverage", color: "var(--chart-4)" },
  "docs-drift": { label: "Docs drift", color: "var(--chart-5)" },
} satisfies ChartConfig;

// Raw chart vars, not ChartStyle's --color-*: these are also read outside a ChartContainer.
export const AGENT_COLOR: Record<AgentName, string> = {
  security: "var(--chart-1)",
  correctness: "var(--chart-2)",
  performance: "var(--chart-3)",
  "test-coverage": "var(--chart-4)",
  "docs-drift": "var(--chart-5)",
};

export type TokenKey = keyof TokenCounts;

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

export function sumTokens(t: TokenCounts): number {
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
