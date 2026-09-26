import type { TokenUsage } from "#src/token-usage";

/** USD per million tokens, one rate per counter. */
export interface ModelPrice {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  "claude-sonnet-4-5": { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  "claude-haiku-4-5": { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
};

// The dearest priced model, so an unknown or unrecorded model is never under-costed.
const FALLBACK_PRICE: ModelPrice = MODEL_PRICES["claude-sonnet-4-5"]!;

export function modelPrice(model: string): ModelPrice | undefined {
  return Object.hasOwn(MODEL_PRICES, model) ? MODEL_PRICES[model] : undefined;
}

/** An absent or unpriced model is costed at the fallback rate. */
export function costOf(model: string | undefined, usage: TokenUsage): number {
  const price = (model === undefined ? undefined : modelPrice(model)) ?? FALLBACK_PRICE;
  return (
    (usage.inputTokens * price.input +
      usage.cacheCreationInputTokens * price.cacheWrite +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
