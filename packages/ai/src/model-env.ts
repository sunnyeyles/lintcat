import { MODEL_PROVIDERS, type ModelProvider } from "@pr-review/schemas";

import {
  apiKeyEnvFor,
  DEFAULT_MODEL_PROVIDER,
  defaultModelFor,
  resolveModelProvider,
  type LanguageModelConfig,
} from "#src/model";

type Env = Readonly<Record<string, string | undefined>>;

/** Every provider's key variable, for a "set X or Y" message. */
export function modelApiKeyEnvNames(): string {
  return MODEL_PROVIDERS.map(apiKeyEnvFor).join(" or ");
}

export interface ModelEnvNames {
  provider: string;
  model: string;
  baseUrl?: string | undefined;
}

function read(env: Env, name: string | undefined): string {
  return name === undefined ? "" : (env[name]?.trim() ?? "");
}

/** Unnamed, the default provider wins when its key is present, else any provider that has one. */
function selectProvider(env: Env, names: ModelEnvNames): ModelProvider {
  const named = read(env, names.provider);
  if (named !== "") {
    return resolveModelProvider(named);
  }
  const hasKey = (provider: ModelProvider) => read(env, apiKeyEnvFor(provider)) !== "";
  return [DEFAULT_MODEL_PROVIDER, ...MODEL_PROVIDERS].find(hasKey) ?? DEFAULT_MODEL_PROVIDER;
}

/** `apiKey` is empty when the chosen provider's key is unset; a named but unknown provider throws. */
export function modelConfigFromEnv(env: Env, names: ModelEnvNames): LanguageModelConfig {
  const provider = selectProvider(env, names);
  const baseUrl = read(env, names.baseUrl);
  return {
    provider,
    apiKey: read(env, apiKeyEnvFor(provider)),
    ...(baseUrl === "" ? {} : { baseUrl }),
    modelId: read(env, names.model) || defaultModelFor(provider),
  };
}
