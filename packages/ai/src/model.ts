// Provider selection: adding a provider is an entry in PROVIDERS and nothing else.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/** The SDK also accepts a gateway model string; we always build a model object. */
export type ReviewModel = Extract<LanguageModel, { modelId: string }>;

interface ProviderCreateOptions {
  apiKey: string;
  baseUrl: string | undefined;
  modelId: string;
}

interface ProviderEntry {
  /** Used when configuration names no model. */
  defaultModel: string;
  /** Environment variable this provider's key conventionally arrives in. */
  apiKeyEnv: string;
  create(options: ProviderCreateOptions): ReviewModel;
}

const PROVIDERS = {
  anthropic: {
    // Haiku hits the turn cap and returns prose too often; a failed review is the dearest kind.
    defaultModel: "claude-sonnet-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    create: ({ apiKey, baseUrl, modelId }: ProviderCreateOptions) =>
      createAnthropic({
        apiKey,
        ...(baseUrl === undefined ? {} : { baseURL: baseUrl }),
      })(modelId),
  },
  openai: {
    defaultModel: "gpt-5.6-luna",
    apiKeyEnv: "OPENAI_API_KEY",
    // .chat, not the callable: that one speaks the Responses API, which
    // most OpenAI-compatible gateways behind baseUrl do not implement.
    create: ({ apiKey, baseUrl, modelId }: ProviderCreateOptions) =>
      createOpenAI({
        apiKey,
        ...(baseUrl === undefined ? {} : { baseURL: baseUrl }),
      }).chat(modelId),
  },
} as const satisfies Record<string, ProviderEntry>;

export type ModelProvider = keyof typeof PROVIDERS;

export const MODEL_PROVIDERS = Object.keys(PROVIDERS) as ModelProvider[];

/** The provider used when configuration names none. */
export const DEFAULT_MODEL_PROVIDER: ModelProvider = "openai";

/** An unusable provider selection, raised before any model call. */
export class ModelProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelProviderError";
  }
}

function isModelProvider(name: string): name is ModelProvider {
  return Object.hasOwn(PROVIDERS, name);
}

/** Empty selects the default; an unknown name throws rather than falling back. */
export function resolveModelProvider(selection: string): ModelProvider {
  const name = selection.trim().toLowerCase();
  if (name === "") {
    return DEFAULT_MODEL_PROVIDER;
  }
  if (!isModelProvider(name)) {
    throw new ModelProviderError(
      `Unknown model provider: ${selection.trim()}. Use one of ${MODEL_PROVIDERS.join(", ")}.`,
    );
  }
  return name;
}

export function defaultModelFor(provider: ModelProvider): string {
  return PROVIDERS[provider].defaultModel;
}

// A hosted repo's model choice, one level below the provider chosen by its key.
const MODEL_CHOICES: Record<ModelProvider, readonly string[]> = {
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5", "claude-sonnet-4-5"],
  openai: ["gpt-5.6-luna", "gpt-5.6-luna-mini"],
};

export function modelChoicesFor(provider: ModelProvider): readonly string[] {
  return MODEL_CHOICES[provider];
}

/** Empty selects the provider's default; an unoffered id throws rather than passing through unchecked. */
export function resolveModelId(provider: ModelProvider, selection: string): string {
  const id = selection.trim();
  if (id === "") return defaultModelFor(provider);
  if (!MODEL_CHOICES[provider].includes(id)) {
    throw new ModelProviderError(
      `Unknown model: ${id}. Use one of ${MODEL_CHOICES[provider].join(", ")}, or leave empty for the default.`,
    );
  }
  return id;
}

export function apiKeyEnvFor(provider: ModelProvider): string {
  return PROVIDERS[provider].apiKeyEnv;
}

export interface LanguageModelConfig {
  provider: ModelProvider;
  apiKey: string;
  /** Gateway, proxy, or compatible endpoint; the SDK default when absent. */
  baseUrl?: string | undefined;
  /** Model id from configuration; never hard-coded. */
  modelId: string;
}

export function createLanguageModel(config: LanguageModelConfig): ReviewModel {
  return PROVIDERS[config.provider].create({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    modelId: config.modelId,
  });
}
