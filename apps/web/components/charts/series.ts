import type { AgentName, Severity, TokenCounts } from "@/lib/data/types";

import type { ChartColorKey } from "./use-chart-colors";

export type SeriesDef<K extends string> = {
  key: K;
  label: string;
  color: ChartColorKey;
};

// Severity is ordered, so it takes the sequential sev-* ramp, recessive to loud.
export const SEVERITY_SERIES: readonly SeriesDef<Severity>[] = [
  { key: "low", label: "Low", color: "sevLow" },
  { key: "medium", label: "Medium", color: "sevMedium" },
  { key: "high", label: "High", color: "sevHigh" },
];

export const AGENT_COLOR: Record<AgentName, ChartColorKey> = {
  security: "agentSecurity",
  correctness: "agentCorrectness",
  performance: "agentPerformance",
  "test-coverage": "agentTests",
  "docs-drift": "agentDocs",
};

export type TokenKey = keyof TokenCounts;

// Ordered cheapest to dearest per the price table, so loudness tracks unit price.
export const TOKEN_SERIES: readonly SeriesDef<TokenKey>[] = [
  { key: "cacheReadInputTokens", label: "Cache read", color: "slateDim" },
  { key: "inputTokens", label: "Input", color: "agentPerformance" },
  { key: "cacheCreationInputTokens", label: "Cache write", color: "sevMedium" },
  { key: "outputTokens", label: "Output", color: "sevHigh" },
];

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
