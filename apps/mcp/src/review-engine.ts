/** Which way a review will be run: the key-backed tool loop, or one client-sampling call. */
import {
  apiKeyEnvFor,
  createSamplingAgent,
  MODEL_PROVIDERS,
} from "@pr-review/ai";
import type { ReviewEngine } from "@pr-review/reviewer";

import type { ConnectedClient } from "#src/client-capabilities";
import { hasModelApiKey, resolveModel, type McpEnvironment } from "#src/environment";

export interface SelectedEngine {
  engine: ReviewEngine;
  /** One sampling request replaced the tool-calling agent; the result must say so. */
  singleShot: boolean;
}

/** Said when the machine has neither a key nor a client willing to run the model. */
export function noModelAccessMessage(): string {
  const keys = MODEL_PROVIDERS.map(apiKeyEnvFor).join(" or ");
  return (
    `No model API key is set and this client does not offer sampling, so there is no way to run a review. ` +
    `Set ${keys} in the MCP server's environment or .env.local, or connect from a client that answers sampling/createMessage.`
  );
}

/** The key-backed engine: the tool-calling agent over the run's model. */
export function modelReviewEngine(environment: McpEnvironment): SelectedEngine {
  return { engine: { model: resolveModel(environment).model }, singleShot: false };
}

/**
 * A provider key always wins: the tool-calling agent reads the repository,
 * and sampling is the fallback for a machine that has no key at all.
 */
export function selectReviewEngine(
  environment: McpEnvironment,
  client: ConnectedClient,
): SelectedEngine {
  if (hasModelApiKey(environment)) {
    return modelReviewEngine(environment);
  }
  if (!client.features().sampling) {
    throw new Error(noModelAccessMessage());
  }
  return {
    engine: {
      createAgent: ({ index }) =>
        createSamplingAgent({
          sample: client.sample,
          ...(index === undefined ? {} : { index }),
        }),
    },
    singleShot: true,
  };
}
