/** Which way a review will be run: the key-backed tool loop, or one client-sampling call. */
import { apiKeyEnvFor, MODEL_PROVIDERS, samplingEngine } from "@pr-review/ai";
import {
  hasModelApiKey,
  modelReviewEngine,
  type LocalEnvironment,
  type SelectedEngine,
} from "@pr-review/local";

import type { ConnectedClient } from "#src/client-capabilities";

/** Said when the machine has neither a key nor a client willing to run the model. */
function noModelAccessMessage(): string {
  const keys = MODEL_PROVIDERS.map(apiKeyEnvFor).join(" or ");
  return (
    `No model API key is set and this client does not offer sampling, so there is no way to run a review. ` +
    `Set ${keys} in the MCP server's environment or .env.local, or connect from a client that answers sampling/createMessage.`
  );
}

/**
 * A provider key always wins: the tool-calling agent reads the repository,
 * and sampling is the fallback for a machine that has no key at all.
 */
export function selectReviewEngine(
  environment: LocalEnvironment,
  client: ConnectedClient,
): SelectedEngine {
  if (hasModelApiKey(environment)) {
    return modelReviewEngine(environment);
  }
  if (!client.features().sampling) {
    throw new Error(noModelAccessMessage());
  }
  return {
    engine: samplingEngine({ sample: client.sample }),
    singleShot: true,
  };
}
