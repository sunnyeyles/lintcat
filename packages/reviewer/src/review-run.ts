/**
 * One review run, assembled: a client, a target, a delivery adapter and a
 * policy in; agents, model, synthesiser, pipeline and memory held here.
 */
import {
  createSynthesiser,
  loadAgentDefinitions,
  resolveAgentDefinitions,
  type AgentDefinition,
  type AgentUsageReport,
  type ManagedPrompts,
  type ReviewAgent,
  type ReviewModel,
  type Synthesiser,
} from "@pr-review/ai";
import type {
  PullRequestReadClient,
  RepositoryHistoryClient,
} from "@pr-review/github";
import type { RepositoryIndex } from "@pr-review/index";
import { createConsoleLogger, type StructuredLogger } from "@pr-review/logging";

import type { MemoryStore } from "#src/memory";
import { createPipelineRunner, type RunReviewPipeline } from "#src/pipeline-runner";
import { readAtCommit } from "#src/read-at-commit";
import type { FinishedReviewRun, ReviewDelivery } from "#src/review-delivery";
import { runReviewPipeline } from "#src/review-pipeline";
import { reviewWithDelivery } from "#src/review-pull-request";
import { reviewCorrelation, type ReviewTarget } from "#src/review-target";

/** What the run does, as opposed to what it reads or where it writes. */
export interface ReviewPolicy {
  /** Review only the commits since this pull request's last review. */
  incremental?: boolean | undefined;
  /** Build the repository index for this run; on unless switched off. */
  index?: boolean | undefined;
}

/**
 * The run's agent set: read from the repository at one commit, so the branch
 * under review cannot choose its own reviewers, or supplied outright.
 */
export type ReviewAgentSource =
  | {
      /** The commit the agent configuration is read at. */
      readAt: string;
      /** Comma-separated categories; empty runs the configured set. */
      select?: string | undefined;
      path?: string | undefined;
    }
  | { use: readonly AgentDefinition[] };

/** What an agent set is built over, once the run has resolved it. */
export interface ReviewAgentRequest {
  client: PullRequestReadClient & RepositoryHistoryClient;
  /** The subset the path gate woke. */
  agents: readonly AgentDefinition[];
  index: RepositoryIndex | undefined;
  logger: StructuredLogger;
}

export type CreateReviewAgents = (
  request: ReviewAgentRequest,
) => readonly ReviewAgent[];

/**
 * What runs the agents. The model form builds the runtime and the synthesiser
 * itself; the scripted form is for harnesses that substitute both.
 */
export type ReviewEngine =
  | {
      model: ReviewModel;
      /** Builds a model by id. Without it, an agent's own `model` is ignored. */
      createModel?: ((modelId: string) => ReviewModel) | undefined;
      systemPrompts?: ManagedPrompts | undefined;
      maxTurns?: number | undefined;
    }
  | { createAgents: CreateReviewAgents; synthesiser: Synthesiser };

/** Repository memory, with the clock that decides what counts as fresh. */
export interface ReviewMemory {
  store: MemoryStore;
  /** Defaults to the wall clock; a test pins it. */
  now?: (() => Date) | undefined;
}

export interface ReviewRunSpec {
  /** Reads only: every write this run makes goes through `delivery`. */
  client: PullRequestReadClient & RepositoryHistoryClient;
  target: ReviewTarget;
  delivery: ReviewDelivery;
  agents: ReviewAgentSource;
  engine: ReviewEngine;
  policy?: ReviewPolicy | undefined;
  /** Omitted, the run reads no memory and attaches no hints. */
  memory?: ReviewMemory | undefined;
  logger?: StructuredLogger | undefined;
}

async function resolveAgents(
  client: PullRequestReadClient,
  target: ReviewTarget,
  source: ReviewAgentSource,
): Promise<AgentDefinition[]> {
  if ("use" in source) {
    return [...source.use];
  }
  const configured = await loadAgentDefinitions({
    readFile: readAtCommit(client, target, source.readAt),
    ...(source.path === undefined ? {} : { path: source.path }),
  });
  return resolveAgentDefinitions(source.select ?? "", configured);
}

function pipelineRunner(
  engine: ReviewEngine,
  agents: readonly AgentDefinition[],
  logger: StructuredLogger,
  usage: AgentUsageReport[],
): RunReviewPipeline {
  if ("createAgents" in engine) {
    const { createAgents, synthesiser } = engine;
    return ({ client, context, agents: active, hints, index }) =>
      runReviewPipeline(
        createAgents({ client, agents: active, index, logger }),
        synthesiser,
        context,
        hints,
      );
  }
  return createPipelineRunner({
    model: engine.model,
    synthesiser: createSynthesiser({ model: engine.model, agents }),
    logger,
    onUsage: (report) => usage.push(report),
    ...(engine.createModel === undefined ? {} : { createModel: engine.createModel }),
    ...(engine.systemPrompts === undefined
      ? {}
      : { systemPrompts: engine.systemPrompts }),
    ...(engine.maxTurns === undefined ? {} : { maxTurns: engine.maxTurns }),
  });
}

/** Configured order, so a run's reports read the same way every time. */
function inAgentOrder(
  reports: readonly AgentUsageReport[],
  agents: readonly AgentDefinition[],
): AgentUsageReport[] {
  const order = agents.map((agent) => agent.category);
  return [...reports].sort(
    (left, right) => order.indexOf(left.agent) - order.indexOf(right.agent),
  );
}

/** Assembles and runs one review. Throws what the review itself throws. */
export async function runReview({
  client,
  target,
  delivery,
  agents: source,
  engine,
  policy = {},
  memory,
  logger = createConsoleLogger(),
}: ReviewRunSpec): Promise<FinishedReviewRun> {
  const agents = await resolveAgents(client, target, source);
  logger.info("review.agents_selected", {
    ...reviewCorrelation(target),
    agents: agents.map((agent) => agent.category),
  });

  const usage: AgentUsageReport[] = [];
  const startedAt = Date.now();
  const outcome = await reviewWithDelivery(target, {
    client,
    agents,
    delivery,
    runReviewPipeline: pipelineRunner(engine, agents, logger, usage),
    logger,
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
    agents,
    usage: inAgentOrder(usage, agents),
    durationMs: Date.now() - startedAt,
  };
  await delivery.publishRun?.(target, run);
  return run;
}
