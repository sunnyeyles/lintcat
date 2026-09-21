/**
 * The GitHub Action entrypoint. Wiring only: read action inputs, build
 * the clients, hand off to runReview.
 */
import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  DEFAULT_LANGFUSE_BASE_URL,
  DEFAULT_PROMPT_LABEL,
  createLangfusePromptClient,
  apiKeyEnvFor,
  createLanguageModel,
  defaultModelFor,
  loadManagedPrompts,
  resolveModelProvider,
  type ModelProvider,
  type LangfusePromptClient,
  type LangfusePromptClientConfig,
  type ManagedPrompts,
  type LanguageModelConfig,
  type ReviewModel,
  GENERAL_AGENT,
} from "@pr-review/ai";
import {
  createTokenClient,
  type GithubTokenConfig,
  type PullRequestReadClient,
  type RepositoryHistoryClient,
  type ReviewPublishClient,
} from "@pr-review/github";
import {
  createConsoleLogger,
  errorMessage,
  errorName,
  type StructuredLogger,
} from "@pr-review/logging";
import {
  createBranchMemoryStore,
  createDashboardPublisher,
  dashboardDelivery,
  githubDelivery,
  isFixCommit,
  learnFromMergedPullRequest,
  reviewCorrelation,
  runReview,
  type DashboardPublisherConfig,
  type FinishedReviewRun,
  type PublishToDashboard,
  type ReviewDelivery,
  type ReviewRunSpec,
  type ReviewTarget,
} from "@pr-review/reviewer";

import { inspectEvent } from "#src/event";
import {
  createLangfuseRuntime,
  type LangfuseRuntime,
  type LangfuseRuntimeConfig,
} from "#src/langfuse";
import { createFallbackPublisher } from "#src/summary";

/** Everything the entrypoint reads from outside itself; tests pass fakes. */
export interface ActionEnvironment {
  /** The process environment the action's inputs arrive in. */
  env: Record<string, string | undefined>;
  /** Reads the workflow event payload file as UTF-8 text. */
  readEventFile: (path: string) => Promise<string>;
  createLanguageModel: (config: LanguageModelConfig) => ReviewModel;
  createTokenClient: (
    config: GithubTokenConfig,
  ) => PullRequestReadClient & RepositoryHistoryClient & ReviewPublishClient;
  /** Builds the managed-prompt retrieval seam. */
  createPromptClient: (config: LangfusePromptClientConfig) => LangfusePromptClient;
  /** Starts span export for this run and returns its flush handle. */
  createLangfuseRuntime: (config: LangfuseRuntimeConfig) => LangfuseRuntime;
  createDashboardPublisher: (
    config: DashboardPublisherConfig,
  ) => PublishToDashboard;
  /** Runs the review the inputs assembled. */
  runReview: (spec: ReviewRunSpec) => Promise<FinishedReviewRun>;
  logger: StructuredLogger;
  /** Marks the process as failed without exiting it. */
  setExitCode: (code: number) => void;
}

/** The real environment: the live process, filesystem, and SDK clients. */
export function actionEnvironment(): ActionEnvironment {
  return {
    env: process.env,
    readEventFile: (filePath) => readFile(filePath, "utf8"),
    createLanguageModel,
    createTokenClient,
    createPromptClient: createLangfusePromptClient,
    createLangfuseRuntime,
    createDashboardPublisher,
    runReview,
    logger: createConsoleLogger(),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

/**
 * Reads an action input. GitHub exposes `with:` entries as INPUT_<NAME>,
 * uppercased with spaces replaced by underscores.
 */
export function getInput(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
  return value?.trim() ?? "";
}

export function requireInput(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = getInput(env, name);
  if (value === "") {
    throw new Error(`Missing required action input: ${name}`);
  }
  return value;
}

/** The Langfuse settings one run needs, once they are known to be usable. */
interface LangfuseInputs {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  promptLabel: string;
  recordIo: boolean;
}

/**
 * undefined means the review runs on in-code prompts and exports no
 * traces. Both keys are needed: the two features authenticate the same way.
 */
function resolveLangfuseInputs(
  env: Record<string, string | undefined>,
  logger: StructuredLogger,
): LangfuseInputs | undefined {
  const publicKey = getInput(env, "langfuse-public-key");
  const secretKey = getInput(env, "langfuse-secret-key");

  if (publicKey === "" && secretKey === "") {
    return undefined;
  }
  if (publicKey === "" || secretKey === "") {
    // Half-configured: the review still runs, but prompt edits and
    // traces silently go nowhere. Never log the key that is present.
    logger.error("langfuse.disabled_incomplete_credentials", {
      missingInput:
        publicKey === "" ? "langfuse-public-key" : "langfuse-secret-key",
    });
    return undefined;
  }

  return {
    publicKey,
    secretKey,
    // The library constants are the single definition; a caller
    // invoking the bundle directly never goes through action.yml.
    baseUrl: getInput(env, "langfuse-base-url") || DEFAULT_LANGFUSE_BASE_URL,
    promptLabel: getInput(env, "langfuse-prompt-label") || DEFAULT_PROMPT_LABEL,
    recordIo: getInput(env, "langfuse-record-io") === "true",
  };
}

/** Where one run's record is sent, once both inputs are known to be usable. */
interface DashboardInputs {
  baseUrl: string;
  token: string;
}

/** undefined means the review is published to GitHub only. */
function resolveDashboardInputs(
  env: Record<string, string | undefined>,
  logger: StructuredLogger,
): DashboardInputs | undefined {
  const baseUrl = getInput(env, "dashboard-url");
  const token = getInput(env, "dashboard-token");

  if (baseUrl === "" && token === "") {
    return undefined;
  }
  if (baseUrl === "" || token === "") {
    // Half-configured: the review still runs, but nothing records it. Never log the token.
    logger.error("dashboard.disabled_incomplete_config", {
      missingInput: baseUrl === "" ? "dashboard-url" : "dashboard-token",
    });
    return undefined;
  }

  return { baseUrl, token };
}

interface DeliveryInputs {
  client: RepositoryHistoryClient & ReviewPublishClient;
  /** Verified patches are committed to the head branch. */
  commitFixes: boolean;
  /** Absent publishes to GitHub only. */
  dashboard: DashboardInputs | undefined;
  /** Value of GITHUB_STEP_SUMMARY; absent outside a real runner. */
  summaryPath: string | undefined;
  logger: StructuredLogger;
}

/** GitHub, with the fork fallback over its check run and the dashboard behind it. */
function actionDelivery(
  environment: Pick<ActionEnvironment, "createDashboardPublisher">,
  { client, commitFixes, dashboard, summaryPath, logger }: DeliveryInputs,
): ReviewDelivery {
  const github = githubDelivery({ client, logger, commitFixes });
  const delivery: ReviewDelivery = {
    ...github,
    // Check run first; job summary when the token cannot create one (forks).
    publishCheckRun: createFallbackPublisher({
      publishCheckRun: github.publishCheckRun,
      summaryPath,
      logger,
    }),
  };
  return dashboard === undefined
    ? delivery
    : dashboardDelivery(
        delivery,
        environment.createDashboardPublisher({ ...dashboard, logger }),
      );
}

/** Covers the one part loadManagedPrompts cannot: building the client. */
async function resolveManagedPrompts(
  environment: ActionEnvironment,
  inputs: LangfuseInputs,
): Promise<ManagedPrompts | undefined> {
  try {
    const client = environment.createPromptClient({
      publicKey: inputs.publicKey,
      secretKey: inputs.secretKey,
      baseUrl: inputs.baseUrl,
    });
    const { prompts } = await loadManagedPrompts(client, {
      agents: [GENERAL_AGENT],
      label: inputs.promptLabel,
      logger: environment.logger,
    });
    return prompts;
  } catch (error: unknown) {
    environment.logger.error("langfuse.prompts.unavailable", {
      error: errorMessage(error),
    });
    return undefined;
  }
}

interface ModelInputs {
  model: ReviewModel;
  provider: ModelProvider;
}

/** Builds the run's model. */
function resolveModelInputs(
  env: Record<string, string | undefined>,
  environment: Pick<ActionEnvironment, "createLanguageModel">,
): ModelInputs {
  const provider = resolveModelProvider(getInput(env, "model-provider"));
  const keyEnv = apiKeyEnvFor(provider);
  // The provider's own variable is the fallback, so a workflow can pass each
  // provider's secret through `env` rather than picking one in YAML.
  const apiKey = getInput(env, "api-key") || (env[keyEnv] ?? "").trim();
  if (apiKey === "") {
    throw new Error(
      `Missing required action input: api-key (or the ${keyEnv} environment variable)`,
    );
  }
  const baseUrl = getInput(env, "model-base-url");
  return {
    provider,
    model: environment.createLanguageModel({
      provider,
      apiKey,
      ...(baseUrl === "" ? {} : { baseUrl }),
      modelId: getInput(env, "model") || defaultModelFor(provider),
    }),
  };
}

/**
 * Whether this run may commit fixes. Fixing our own fix commit would loop, so
 * an unreadable head commit disables the step rather than risking one.
 */
async function fixesAllowed(
  client: Pick<RepositoryHistoryClient, "getCommitMessage">,
  target: ReviewTarget,
  logger: StructuredLogger,
): Promise<boolean> {
  try {
    const message = await client.getCommitMessage({
      owner: target.owner,
      repo: target.repo,
      sha: target.headSha,
    });
    if (isFixCommit(message)) {
      logger.info("review.fixes.disabled", {
        ...reviewCorrelation(target),
        reason: "the head commit is this action's own fix",
      });
      return false;
    }
    return true;
  } catch (error: unknown) {
    logger.error("review.fixes.disabled", {
      ...reviewCorrelation(target),
      reason: errorMessage(error),
    });
    return false;
  }
}

/** One action run. Failures propagate to runEntrypoint's catch. */
export async function runAction(
  environment: ActionEnvironment = actionEnvironment(),
): Promise<void> {
  const { env, logger } = environment;

  const eventPath = env["GITHUB_EVENT_PATH"];
  if (eventPath === undefined || eventPath === "") {
    throw new Error(
      "GITHUB_EVENT_PATH is not set — this action must run inside a GitHub Actions workflow",
    );
  }
  const payload: unknown = JSON.parse(await environment.readEventFile(eventPath));
  const eventName = env["GITHUB_EVENT_NAME"] ?? "";

  // Empty disables the memory entirely: no branch is read, and none written.
  const memoryBranch = getInput(env, "memory-branch");

  // An event that will not be reviewed is a clean no-op: it must not fail
  // on configuration, and it has no base commit to read one from anyway.
  const inspection = inspectEvent(payload, eventName);
  if (!inspection.review) {
    if (inspection.learn !== true) {
      logger.info("review.skipped", { reason: inspection.reason });
      return;
    }
    if (memoryBranch === "") {
      logger.info("review.skipped", { reason: "memory-branch not set" });
      return;
    }
    // Before any model wiring: a merge must not fail on a missing api-key.
    const learnClient = environment.createTokenClient({
      token: requireInput(env, "github-token"),
    });
    await learnFromMergedPullRequest(inspection.target, {
      client: learnClient,
      store: createBranchMemoryStore(
        learnClient,
        inspection.target,
        memoryBranch,
      ),
      logger,
    });
    return;
  }
  const { target, isFork } = inspection;

  const client = environment.createTokenClient({
    token: requireInput(env, "github-token"),
  });

  const { model, provider } = resolveModelInputs(env, environment);
  logger.info("review.model_selected", { provider, model: model.modelId });

  const langfuse = resolveLangfuseInputs(env, logger);
  const dashboard = resolveDashboardInputs(env, logger);
  // Tracing starts before the prompt fetch so the fetch's spans are captured.
  const tracing =
    langfuse === undefined
      ? undefined
      : environment.createLangfuseRuntime({
          publicKey: langfuse.publicKey,
          secretKey: langfuse.secretKey,
          baseUrl: langfuse.baseUrl,
          release: env["GITHUB_SHA"],
          recordIo: langfuse.recordIo,
        });
  // Everything below may emit spans, so it sits inside the flushing block.
  try {
    const prompts =
      langfuse === undefined
        ? undefined
        : await resolveManagedPrompts(environment, langfuse);

    // Event-inspection knowledge: the reviewer only ever sees the permission
    // failure a fork's token causes, never the fork itself.
    const applyFixes =
      getInput(env, "fix") === "true" &&
      (await fixesAllowed(client, target, logger));
    logger.info("review.started", {
      ...reviewCorrelation(target),
      isFork,
      applyFixes,
    });

    await environment.runReview({
      client,
      target,
      delivery: actionDelivery(environment, {
        client,
        commitFixes: applyFixes,
        dashboard,
        summaryPath: env["GITHUB_STEP_SUMMARY"],
        logger,
      }),
      engine: {
        model,
        ...(prompts === undefined ? {} : { systemPrompts: prompts }),
      },
      policy: {
        incremental: getInput(env, "incremental") === "true",
        // On unless it is switched off, which is the opposite of the others.
        index: getInput(env, "index") !== "false",
      },
      ...(memoryBranch === ""
        ? {}
        : {
            memory: {
              store: createBranchMemoryStore(client, target, memoryBranch),
            },
          }),
      logger,
    });
  } finally {
    // A flush failure never fails a review that already ran.
    if (tracing !== undefined) {
      try {
        await tracing.forceFlush();
      } catch (error: unknown) {
        logger.error("tracing.flush_failed", {
          error: errorMessage(error),
        });
      }
    }
  }
}

/** The entrypoint guard: importing this module performs no work. */
export function runEntrypoint(
  environment: ActionEnvironment = actionEnvironment(),
): void {
  if (environment.env["GITHUB_ACTIONS"] !== "true") {
    return;
  }
  runAction(environment).catch((error: unknown) => {
    environment.logger.error("review.failed", {
      error: errorMessage(error),
      errorName: errorName(error),
    });
    environment.setExitCode(1);
  });
}

runEntrypoint();
