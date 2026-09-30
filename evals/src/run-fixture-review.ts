/**
 * Drives the real review pipeline for one fixture. Only the GitHub client and
 * the delivery adapter differ from production.
 */
import {
  createLanguageModel,
  toolLoopEngine,
  type AgentUsageReport,
  type ReviewEngine,
} from "@pr-review/ai";
import type { StructuredLogger } from "@pr-review/logging";
import {
  recordingDelivery,
  runReview,
  type RenderedCheckRun,
  type ReviewOutcome,
} from "@pr-review/reviewer";

import { createFixtureClient, type FixtureCall } from "#src/fixture-client";
import type { LoadedFixture } from "#src/fixture";
import type { ModelAccess } from "#src/model-access";

/** The model-facing half of a review; the harness's own tests inject a scripted engine. */
export interface FixtureReviewDeps {
  engine: ReviewEngine;
  logger: StructuredLogger;
}

/** Everything one fixture review produced, for expectations to judge. */
export interface FixtureReview {
  fixture: LoadedFixture;
  /** The pipeline's own result: candidates, final findings, patches. */
  result: ReviewOutcome;
  /** The check run a real review would have published. */
  rendered: RenderedCheckRun;
  /** Every read of the fixture repository, the pipeline's own included. */
  calls: readonly FixtureCall[];
}

/** The production engine, with each agent's spend also handed to `onUsage`. */
export function modelBackedDeps(
  access: ModelAccess,
  logger: StructuredLogger,
  onUsage?: (report: AgentUsageReport) => void,
): FixtureReviewDeps {
  const engine = toolLoopEngine({
    model: createLanguageModel({
      provider: access.provider,
      apiKey: access.apiKey,
      modelId: access.model,
    }),
  });
  return {
    engine: {
      createAgent: (request) =>
        engine.createAgent({
          ...request,
          onUsage: (report) => {
            request.onUsage(report);
            onUsage?.(report);
          },
        }),
    },
    logger,
  };
}

/** Runs one fixture through the full review and returns what it produced. */
export async function runFixtureReview(
  fixture: LoadedFixture,
  deps: FixtureReviewDeps,
): Promise<FixtureReview> {
  const { client, calls } = createFixtureClient(fixture);
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
    engine: deps.engine,
    logger: deps.logger,
  });

  if (recorded.checkRun === undefined) {
    throw new Error(
      `the review of fixture ${fixture.name} finished without rendering a check run`,
    );
  }

  return {
    fixture,
    result: run.outcome,
    rendered: recorded.checkRun,
    calls,
  };
}
