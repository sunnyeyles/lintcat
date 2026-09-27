/**
 * One review run, assembled: a client, a target, an engine, a delivery adapter
 * and a policy in; agent, pipeline and memory held here.
 */
import {
  addTokenUsage,
  emptyTokenUsage,
  GENERAL_AGENT,
  type AgentUsageReport,
  type ReviewEngine,
} from "@pr-review/ai";
import { createConsoleLogger, type StructuredLogger } from "@pr-review/logging";

import type { MemoryStore } from "#src/memory";
import type { ReviewClient, RunReviewPipeline } from "#src/pipeline-runner";
import type { FinishedReviewRun, ReviewDelivery } from "#src/review-delivery";
import { runReviewPipeline } from "#src/review-pipeline";
import { reviewWithDelivery } from "#src/review-pull-request";
import type { ReviewTarget } from "#src/review-target";

/** What the run does, as opposed to what it reads or where it writes. */
export interface ReviewPolicy {
  /** Review only the commits since this pull request's last review. */
  incremental?: boolean | undefined;
  /** Build the repository index for this run; on unless switched off. */
  index?: boolean | undefined;
  /** Suggest reviewers on the check run; on unless switched off. */
  suggestReviewers?: boolean | undefined;
}

/** Repository memory, with the clock that decides what counts as fresh. */
export interface ReviewMemory {
  store: MemoryStore;
  /** Defaults to the wall clock; a test pins it. */
  now?: (() => Date) | undefined;
}

export interface ReviewRunSpec {
  /** Reads only: every write this run makes goes through `delivery`. */
  client: ReviewClient;
  target: ReviewTarget;
  delivery: ReviewDelivery;
  engine: ReviewEngine;
  policy?: ReviewPolicy | undefined;
  /** Omitted, the run reads no memory and attaches no hints. */
  memory?: ReviewMemory | undefined;
  logger?: StructuredLogger | undefined;
  /** Aborting it stops the agent and publishes nothing. */
  signal?: AbortSignal | undefined;
}

function pipelineRunner(
  engine: ReviewEngine,
  logger: StructuredLogger,
  onUsage: (report: AgentUsageReport) => void,
): RunReviewPipeline {
  return ({ client, context, agent, index }) =>
    runReviewPipeline(
      engine.createAgent({ agent, github: client, index, logger, onUsage }),
      context,
    );
}

/** Assembles and runs one review. Throws what the review itself throws. */
export async function runReview({
  client,
  target,
  delivery,
  engine,
  policy = {},
  memory,
  logger = createConsoleLogger(),
  signal,
}: ReviewRunSpec): Promise<FinishedReviewRun> {
  let usage = emptyTokenUsage();
  const startedAt = Date.now();
  const outcome = await reviewWithDelivery(target, {
    client,
    agent: GENERAL_AGENT,
    delivery,
    runReviewPipeline: pipelineRunner(engine, logger, (report) => {
      usage = addTokenUsage(usage, report.usage);
    }),
    logger,
    signal,
    ...(memory === undefined
      ? {}
      : {
          memoryStore: memory.store,
          ...(memory.now === undefined ? {} : { now: memory.now }),
        }),
    ...(policy.incremental === undefined
      ? {}
      : { incremental: policy.incremental }),
    ...(policy.index === undefined ? {} : { index: policy.index }),
    ...(policy.suggestReviewers === undefined
      ? {}
      : { suggestReviewers: policy.suggestReviewers }),
  });

  const run: FinishedReviewRun = {
    outcome,
    usage,
    durationMs: Date.now() - startedAt,
  };
  await delivery.publishRun?.(target, run);
  return run;
}
