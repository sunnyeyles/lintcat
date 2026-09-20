/** Which way a review will be run: the key-backed tool loop, or one client-sampling call. */
import {
  apiKeyEnvFor,
  createSamplingAgent,
  GENERAL_AGENT,
  MODEL_PROVIDERS,
  type Synthesiser,
} from "@pr-review/ai";
import type { ReviewAgentSource, ReviewEngine } from "@pr-review/reviewer";

import type { ConnectedClient } from "#src/client-capabilities";
import { hasModelApiKey, resolveModel, type McpEnvironment } from "#src/environment";

/** A standalone lone agent skips synthesis, so this is never reached. */
const NO_SYNTHESIS: Synthesiser = {
  synthesise: () =>
    Promise.reject(
      new Error("a single-shot sampling review has nothing to synthesise"),
    ),
};

export interface SelectedEngine {
  engine: ReviewEngine;
  agents: ReviewAgentSource;
  /** One sampling request replaced the tool-calling agents; the result must say so. */
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

/** The key-backed engine: tool-calling agents, read from the repository at the base commit. */
export function modelReviewEngine(
  environment: McpEnvironment,
  request: { baseSha: string; select: string },
): SelectedEngine {
  const { model, createModel } = resolveModel(environment);
  return {
    engine: { model, createModel },
    agents: { readAt: request.baseSha, select: request.select },
    singleShot: false,
  };
}

/**
 * A provider key always wins: the tool-calling agents read the repository,
 * and sampling is the fallback for a machine that has no key at all.
 */
export function selectReviewEngine(
  environment: McpEnvironment,
  client: ConnectedClient,
  request: { baseSha: string; select: string },
): SelectedEngine {
  if (hasModelApiKey(environment)) {
    return modelReviewEngine(environment, request);
  }
  if (!client.features().sampling) {
    throw new Error(noModelAccessMessage());
  }
  return {
    engine: {
      createAgents: ({ index }) => [
        createSamplingAgent({
          sample: client.sample,
          ...(index === undefined ? {} : { index }),
        }),
      ],
      synthesiser: NO_SYNTHESIS,
    },
    agents: { use: [GENERAL_AGENT] },
    singleShot: true,
  };
}
