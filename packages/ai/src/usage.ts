import type { TokenUsage } from "@pr-review/schemas";
import type { LanguageModelUsage } from "ai";

/** Maps the SDK's usage onto our counters; its `inputTokens` is the total. */
export function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  const cacheReadInputTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheCreationInputTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const uncached =
    usage.inputTokenDetails.noCacheTokens ??
    (usage.inputTokens ?? 0) - cacheReadInputTokens - cacheCreationInputTokens;
  return {
    inputTokens: Math.max(0, uncached),
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens: usage.outputTokens ?? 0,
  };
}
