import {
  createReviewAgent,
  type AgentDefinition,
  type ReviewAgentDeps,
  type ReviewContext,
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

/** What one review reads. The two optional methods are absent on an adapter with no commit graph. */
export type ReviewClient = PullRequestReadClient &
  Pick<RepositoryHistoryClient, "listCommitShas" | "listPullRequestCommitShas"> &
  Partial<Pick<RepositoryHistoryClient, "listCommitFiles" | "compareCommits">>;

/** One pipeline run's inputs, named rather than positional. */
export interface ReviewPipelineRun {
  client: ReviewClient;
  context: ReviewContext;
  /** The review agent, already carrying this run's repository hints. */
  agent: AgentDefinition;
  index: RepositoryIndex | undefined;
}

/** Runs the review agent, then validates what it proposed. */
export type RunReviewPipeline = (
  run: ReviewPipelineRun,
) => Promise<ReviewPipelineResult>;

export type PipelineRunnerDeps = Omit<ReviewAgentDeps, "github" | "index">;

/** Binds the agent to each review's client and index, then runs the pipeline. */
export function createPipelineRunner(deps: PipelineRunnerDeps): RunReviewPipeline {
  return ({ client, context, agent, index }) =>
    runReviewPipeline(
      createReviewAgent(agent, {
        ...deps,
        github: client,
        ...(index === undefined ? {} : { index }),
      }),
      context,
    );
}
