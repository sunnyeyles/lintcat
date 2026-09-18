/**
 * Drives the real review pipeline for one fixture. Only the GitHub client and
 * the publish step differ from production.
 */
import process from "node:process";

import {
  createLanguageModel,
  createReviewAgents,
  createSynthesiser,
  type ReviewAgent,
  type AgentDefinition,
  type Synthesiser,
} from "@pr-review/ai";
import type { GithubInstallationClient } from "@pr-review/github";
import {
  buildLayerA,
  buildLayerB,
  createInMemoryIndex,
  createLocalFileSource,
  type LayerBIndex,
  type RepositoryIndex,
} from "@pr-review/index";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import {
  reviewPullRequest,
  runReviewPipeline,
  type RenderedCheckRun,
  type ReviewOutcome,
} from "@pr-review/reviewer";

import { createFixtureClient } from "./fixture-client.js";
import type { LoadedFixture } from "./fixture.js";
import type { ModelAccess } from "./model-access.js";

/** Set to `off` to run the suite in absent mode; the other half of the phase-2 gate. */
export const INDEX_ENV = "EVAL_INDEX";

/** The model-facing half of a review; the harness's own tests inject scripted agents. */
export interface FixtureReviewDeps {
  /** The agent set the review gates by path and then runs. */
  agents: readonly AgentDefinition[];
  /** Built over the review's own logger, so every event of one fixture lands together. */
  createAgents: (
    github: GithubInstallationClient,
    logger: StructuredLogger,
    agents: readonly AgentDefinition[],
    index: RepositoryIndex | undefined,
  ) => readonly ReviewAgent[];
  synthesiser: Synthesiser;
  logger: StructuredLogger;
}

/** Everything one fixture review produced, for expectations to judge. */
export interface FixtureReview {
  fixture: LoadedFixture;
  /** The pipeline's own result: candidates, failures, final findings, patches. */
  result: ReviewOutcome;
  /** The check run a real review would have published. */
  rendered: RenderedCheckRun;
  /** The index the agents' tools ran against; undefined is absent mode. */
  index: RepositoryIndex | undefined;
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
    createAgents: (github, reviewLogger, activeAgents, index) =>
      createReviewAgents(
        {
          model,
          createModel,
          github,
          logger: reviewLogger,
          ...(index === undefined ? {} : { index }),
        },
        activeAgents,
      ),
    synthesiser: createSynthesiser({ model, agents }),
    logger,
  };
}

/** `EVAL_INDEX=off` reviews without an index, which is what the A/B gate compares against. */
export function indexEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env[INDEX_ENV] ?? "on").toLowerCase() !== "off";
}

/** One build per fixture per run: the tree never moves while the suite runs. */
const indexCache = new Map<string, Promise<RepositoryIndex | undefined>>();

/** Layer B needs a TypeScript project; without one the fixture gets Layer A alone. */
async function buildFixtureLayerB(
  fixture: LoadedFixture,
  logger: StructuredLogger,
): Promise<LayerBIndex | undefined> {
  if (!fixture.headFiles.has("tsconfig.json")) {
    return undefined;
  }
  try {
    return await buildLayerB(fixture.repoDir, {});
  } catch (error) {
    // A missing indexer is partial coverage, exactly as in production.
    logger.error("eval.index.layer_b_failed", {
      fixture: fixture.name,
      reason: errorMessage(error),
      fallback: "reviewing this fixture with Layer A only",
    });
    return undefined;
  }
}

async function buildFixtureIndex(
  fixture: LoadedFixture,
  logger: StructuredLogger,
): Promise<RepositoryIndex | undefined> {
  const startedAt = Date.now();
  try {
    const layerA = await buildLayerA(
      createLocalFileSource(fixture.repoDir, fixture.pullRequest.headSha),
    );
    const layerB = await buildFixtureLayerB(fixture, logger);
    logger.info("eval.index.built", {
      fixture: fixture.name,
      files: layerA.coverage.files,
      packages: layerA.packages.length,
      symbols: layerB?.symbols.length ?? 0,
      references: layerB?.references.length ?? 0,
      durationMs: Date.now() - startedAt,
    });
    return createInMemoryIndex({ ...layerA, layerB });
  } catch (error) {
    logger.error("eval.index.failed", {
      fixture: fixture.name,
      reason: errorMessage(error),
      durationMs: Date.now() - startedAt,
      fallback: "reviewing this fixture without the repository index",
    });
    return undefined;
  }
}

/** The fixture's index, built once and reused; undefined when the env turns it off. */
export async function fixtureIndex(
  fixture: LoadedFixture,
  logger: StructuredLogger,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RepositoryIndex | undefined> {
  if (!indexEnabled(env)) {
    return undefined;
  }
  const cached = indexCache.get(fixture.name);
  if (cached !== undefined) {
    return cached;
  }
  const building = buildFixtureIndex(fixture, logger);
  indexCache.set(fixture.name, building);
  return building;
}

/** Runs one fixture through the full review and returns what it produced. */
export async function runFixtureReview(
  fixture: LoadedFixture,
  deps: FixtureReviewDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FixtureReview> {
  const { client } = createFixtureClient(fixture);
  const { logger } = deps;
  const index = await fixtureIndex(fixture, logger, env);

  let rendered: RenderedCheckRun | undefined;
  const result = await reviewPullRequest(
    {
      owner: fixture.context.owner,
      repo: fixture.context.repo,
      pullRequestNumber: fixture.pullRequest.number,
      headSha: fixture.pullRequest.headSha,
    },
    {
      client,
      agents: deps.agents,
      index,
      runReviewPipeline: (
        reviewClient,
        context,
        activeAgents,
        hints,
        reviewIndex,
      ) =>
        runReviewPipeline(
          deps.createAgents(reviewClient, logger, activeAgents, reviewIndex),
          deps.synthesiser,
          context,
          hints,
        ),
      // The steps an evaluation replaces.
      publishReview: async (_target, checkRun) => {
        rendered = checkRun;
      },
      // An evaluation has no comment surface, so the check run keeps the
      // annotations it judges.
      publishReviewComments: async () => "unavailable",
      logger,
    },
  );

  if (rendered === undefined) {
    throw new Error(
      `the review of fixture ${fixture.name} finished without rendering a check run`,
    );
  }

  return { fixture, result, rendered, index };
}
