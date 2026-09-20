/**
 * Drives the real review pipeline for one fixture. Only the GitHub client and
 * the delivery adapter differ from production.
 */
import {
  createLanguageModel,
  createReviewAgents,
  createSynthesiser,
  type AgentDefinition,
  type Synthesiser,
} from "@pr-review/ai";
import type { StructuredLogger } from "@pr-review/logging";
import {
  recordingDelivery,
  runReview,
  type CreateReviewAgents,
  type RenderedCheckRun,
  type ReviewMemory,
  type ReviewOutcome,
} from "@pr-review/reviewer";

import { createFixtureClient } from "#src/fixture-client";
import type { LoadedFixture } from "#src/fixture";
import type { ModelAccess } from "#src/model-access";

/** The model-facing half of a review; the harness's own tests inject scripted agents. */
export interface FixtureReviewDeps {
  /** The agent set the review gates by path and then runs. */
  agents: readonly AgentDefinition[];
  /** Built over the review's own logger, so every event of one fixture lands together. */
  createAgents: CreateReviewAgents;
  synthesiser: Synthesiser;
  logger: StructuredLogger;
  /** The repository memory the fixture reviews against; absent means none. */
  memory?: ReviewMemory | undefined;
}

/** Everything one fixture review produced, for expectations to judge. */
export interface FixtureReview {
  fixture: LoadedFixture;
  /** The agent set that produced it, which decides how a finding's category reads. */
  agents: readonly AgentDefinition[];
  /** The pipeline's own result: candidates, failures, final findings, patches. */
  result: ReviewOutcome;
  /** The check run a real review would have published. */
  rendered: RenderedCheckRun;
}

/**
 * The production wiring, over the agent set the caller evaluates —
 * normally this repository's own configuration.
 */
export function modelBackedDeps(
  access: ModelAccess,
  logger: StructuredLogger,
  agents: readonly AgentDefinition[],
): FixtureReviewDeps {
  const createModel = (modelId: string) =>
    createLanguageModel({
      provider: access.provider,
      apiKey: access.apiKey,
      modelId,
    });
  const model = createModel(access.model);
  return {
    agents,
    createAgents: ({ client, agents: active, index, logger: reviewLogger }) =>
      createReviewAgents(
        { model, createModel, github: client, logger: reviewLogger, index },
        active,
      ),
    synthesiser: createSynthesiser({ model, agents }),
    logger,
  };
}

/** Runs one fixture through the full review and returns what it produced. */
export async function runFixtureReview(
  fixture: LoadedFixture,
  deps: FixtureReviewDeps,
): Promise<FixtureReview> {
  const { client } = createFixtureClient(fixture);
  const { delivery, recorded } = recordingDelivery();

  const run = await runReview({
    client,
    target: {
      owner: fixture.context.owner,
      repo: fixture.context.repo,
      pullRequestNumber: fixture.pullRequest.number,
      headSha: fixture.pullRequest.headSha,
    },
    delivery,
    agents: { use: deps.agents },
    engine: { createAgents: deps.createAgents, synthesiser: deps.synthesiser },
    logger: deps.logger,
    ...(deps.memory === undefined ? {} : { memory: deps.memory }),
  });

  if (recorded.checkRun === undefined) {
    throw new Error(
      `the review of fixture ${fixture.name} finished without rendering a check run`,
    );
  }

  return {
    fixture,
    agents: deps.agents,
    result: run.outcome,
    rendered: recorded.checkRun,
  };
}
