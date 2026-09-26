/**
 * The one place the evaluations read model credentials. The key is never
 * stored, defaulted, or logged, and missing credentials fail fast.
 */
import {
  DEFAULT_MODEL_PROVIDER,
  apiKeyEnvFor,
  defaultModelFor,
  modelConfigFromEnv,
} from "@pr-review/ai";
import { MODEL_PROVIDERS, type ModelProvider } from "@pr-review/schemas";

/** Environment variable selecting the provider under evaluation. */
const PROVIDER_ENV = "MODEL_PROVIDER";

/** Environment variable overriding the model under evaluation. */
const MODEL_ENV = "MODEL_ID";

/** Model credentials for one evaluation run. */
export interface ModelAccess {
  provider: ModelProvider;
  apiKey: string;
  model: string;
}

/** The actionable message shown when the provider's API key is absent. */
function missingApiKeyMessage(provider: ModelProvider): string {
  const keyEnv = apiKeyEnvFor(provider);
  return [
    `${keyEnv} is not set, so the review evaluations cannot run against ${provider}.`,
    "",
    "These evaluations drive the real review pipeline against the fixtures in",
    "evals/fixtures, which means real model calls and real token spend. No model",
    "call was made and no fixture was evaluated.",
    "",
    "To run them, set the key in the environment and re-run:",
    "",
    `  export ${keyEnv}=…            # your ${provider} API key`,
    `  export ${PROVIDER_ENV}=…       # optional; ${MODEL_PROVIDERS.join(" | ")}, defaults to ${DEFAULT_MODEL_PROVIDER}`,
    `  export ${MODEL_ENV}=…          # optional; defaults to ${defaultModelFor(provider)}`,
    "  pnpm eval",
    "",
    "The fast unit suite (pnpm test) never calls a model and needs no key.",
  ].join("\n");
}

/** Throws missingApiKeyMessage when the provider's key is absent. */
export function requireModelAccess(
  env: Record<string, string | undefined>,
): ModelAccess {
  const { provider, apiKey, modelId } = modelConfigFromEnv(env, {
    provider: PROVIDER_ENV,
    model: MODEL_ENV,
  });
  if (apiKey === "") {
    throw new Error(missingApiKeyMessage(provider));
  }
  return { provider, apiKey, model: modelId };
}
