import {
  createReviewAgents,
  type AgentDefinition,
  type AgentLifecycleListener,
  type ReviewAgentDeps,
  type ReviewContext,
  type Synthesiser,
  type SynthesisHints,
} from "@pr-review/ai";
import type { GithubInstallationClient } from "@pr-review/github";
import type { RepositoryIndex } from "@pr-review/index";

import {
  runReviewPipeline,
  type ReviewPipelineResult,
} from "#src/review-pipeline";

/** Runs one review's agents; `agents` is the subset the path gate woke. */
export type RunReviewPipeline = (
  client: GithubInstallationClient,
  context: ReviewContext,
  agents: readonly AgentDefinition[],
  hints: SynthesisHints,
  index: RepositoryIndex | undefined,
) => Promise<ReviewPipelineResult>;

export interface PipelineRunnerDeps
  extends Omit<ReviewAgentDeps, "github" | "index"> {
  synthesiser: Synthesiser;
  /** Receives each agent's started / completed / failed step. */
  onAgentEvent?: AgentLifecycleListener | undefined;
}

/** Binds the agents to each review's client and index, then runs the pipeline. */
export function createPipelineRunner({
  synthesiser,
  onAgentEvent,
  ...agentDeps
}: PipelineRunnerDeps): RunReviewPipeline {
  return (client, context, agents, hints, index) =>
    runReviewPipeline(
      createReviewAgents(
        { ...agentDeps, github: client, ...(index === undefined ? {} : { index }) },
        agents,
      ),
      synthesiser,
      context,
      hints,
      onAgentEvent,
    );
}
