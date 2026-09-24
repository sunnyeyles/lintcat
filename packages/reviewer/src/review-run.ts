/**
 * One review run, assembled: a client, a target, a delivery adapter and a
 * policy in; agent, model, pipeline and memory held here.
 */
import {
  addTokenUsage,
  emptyTokenUsage,
  GENERAL_AGENT,
  type AgentDefinition,
  type ReviewAgent,
  type ReviewModel,
  type TokenUsage,
} from "@pr-review/ai";
import type { RepositoryIndex } from "@pr-review/index";
import { createConsoleLogger, type StructuredLogger } from "@pr-review/logging";

import type { MemoryStore } from "#src/memory";
import {
  createPipelineRunner,
  type ReviewClient,
  type RunReviewPipeline,
} from "#src/pipeline-runner";
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
}

/** What the agent is built over, once the run has resolved it. */
export interface ReviewAgentRequest {
  client: ReviewClient;
  agent: AgentDefinition;
  index: RepositoryIndex | undefined;
  logger: StructuredLogger;
}

export type CreateReviewAgent = (request: ReviewAgentRequest) => ReviewAgent;

/**
 * What runs the agent. The model form builds the runtime itself; the
 * scripted form is for harnesses that substitute it.
 */
export type ReviewEngine =
  | {
      model: ReviewModel;
      maxTurns?: number | undefined;
    }
  | { createAgent: CreateReviewAgent };

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
  onUsage: (usage: TokenUsage) => void,
): RunReviewPipeline {
  if ("createAgent" in engine) {
    const { createAgent } = engine;
    return ({ client, context, agent, index }) =>
      runReviewPipeline(createAgent({ client, agent, index, logger }), context);
  }
  return createPipelineRunner({
    model: engine.model,
    logger,
    onUsage: (report) => onUsage(report.usage),
    ...(engine.maxTurns === undefined ? {} : { maxTurns: engine.maxTurns }),
  });
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
    runReviewPipeline: pipelineRunner(engine, logger, (spent) => {
      usage = addTokenUsage(usage, spent);
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
  });

  const run: FinishedReviewRun = {
    outcome,
    usage,
    durationMs: Date.now() - startedAt,
  };
  await delivery.publishRun?.(target, run);
  return run;
}
