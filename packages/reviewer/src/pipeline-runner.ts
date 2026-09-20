import {
  createReviewAgents,
  type AgentDefinition,
  type ReviewAgentDeps,
  type ReviewContext,
  type Synthesiser,
  type SynthesisHints,
} from "@pr-review/ai";
import type {
  PullRequestReadClient,
  RepositoryHistoryClient,
} from "@pr-review/github";
import type { RepositoryIndex } from "@pr-review/index";

import {
  runReviewPipeline,
  type ReviewPipelineResult,
} from "#src/review-pipeline";

/** One pipeline run's inputs, named rather than positional. */
export interface ReviewPipelineRun {
  client: PullRequestReadClient & RepositoryHistoryClient;
  context: ReviewContext;
  /** The subset of the run's agents the path gate woke. */
  agents: readonly AgentDefinition[];
  hints: SynthesisHints;
  index: RepositoryIndex | undefined;
}

/** Runs one review's agents, then synthesise and validate. */
export type RunReviewPipeline = (
  run: ReviewPipelineRun,
) => Promise<ReviewPipelineResult>;

export interface PipelineRunnerDeps
  extends Omit<ReviewAgentDeps, "github" | "index"> {
  synthesiser: Synthesiser;
}

/** Binds the agents to each review's client and index, then runs the pipeline. */
export function createPipelineRunner({
  synthesiser,
  ...agentDeps
}: PipelineRunnerDeps): RunReviewPipeline {
  return ({ client, context, agents, hints, index }) =>
    runReviewPipeline(
      createReviewAgents(
        { ...agentDeps, github: client, ...(index === undefined ? {} : { index }) },
        agents,
      ),
      synthesiser,
      context,
      hints,
    );
}
