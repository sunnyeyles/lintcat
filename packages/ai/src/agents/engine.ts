/** The engine seam: what runs the review agent, handed everything one review knows. */
import type { RepositoryIndex } from "@pr-review/index";
import type { StructuredLogger } from "@pr-review/logging";

import type { ReviewAgent } from "#src/agent-contract";
import type { AgentDefinition } from "#src/agents/definition";
import {
  createReviewAgent,
  type AgentUsageReport,
} from "#src/agents/runtime";
import { createSamplingAgent, type SampleText } from "#src/agents/sampling-agent";
import type { ReviewToolsClient } from "#src/agents/tools";
import type { ReviewModel } from "#src/model";

/** One review's agent request; the scope arrives with the context `run` is given. */
export interface AgentRequest {
  /** Carries this run's repository hints. */
  agent: AgentDefinition;
  github: ReviewToolsClient;
  index: RepositoryIndex | undefined;
  logger: StructuredLogger;
  onUsage: (report: AgentUsageReport) => void;
}

export interface ReviewEngine {
  createAgent(request: AgentRequest): ReviewAgent;
}

/** The tool loop over a provider model. */
export function toolLoopEngine(options: {
  model: ReviewModel;
  maxTurns?: number | undefined;
}): ReviewEngine {
  return {
    createAgent: ({ agent, github, index, logger, onUsage }) =>
      createReviewAgent(agent, {
        model: options.model,
        github,
        logger,
        onUsage,
        ...(index === undefined ? {} : { index }),
        ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      }),
  };
}

/** One completion on the connected client's model. */
export function samplingEngine(options: {
  sample: SampleText;
  maxTokens?: number | undefined;
}): ReviewEngine {
  return {
    createAgent: ({ agent, github, index, onUsage }) =>
      createSamplingAgent({
        sample: options.sample,
        agent,
        github,
        index,
        onUsage,
        maxTokens: options.maxTokens,
      }),
  };
}
