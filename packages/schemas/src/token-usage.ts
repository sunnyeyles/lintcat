/** Four counters, not two: where a provider caches, the three input counters bill differently. */
export interface TokenUsage {
  /** Input tokens processed at full price — the uncached remainder. */
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  };
}

export function addTokenUsage(total: TokenUsage, usage: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    cacheCreationInputTokens:
      total.cacheCreationInputTokens + usage.cacheCreationInputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens + usage.cacheReadInputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
  };
}
