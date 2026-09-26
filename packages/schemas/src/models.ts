export const MODEL_PROVIDERS = ["anthropic", "openai"] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/** A hosted repo's model choice, one level below the provider chosen by its key. */
export const MODEL_CHOICES: Readonly<Record<ModelProvider, readonly string[]>> = {
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5", "claude-sonnet-4-5"],
  openai: ["gpt-5.6-luna", "gpt-5.6-luna-mini"],
};
