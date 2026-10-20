/**
 * One claimed review job, end to end: mint a token, open the key, run the
 * review, and settle the row.
 */
import {
  isCancellation,
  ModelProviderError,
  resolveModelId,
  resolveModelProvider,
  toolLoopEngine,
  traceStage,
  type LanguageModelConfig,
  type ReviewModel,
} from "@pr-review/ai";
import {
  completeReviewJob,
  effectiveRepoSettings,
  failReviewJob,
  findReviewJobContext,
  ModelKeyUnreadableError,
  readModelKey,
  renewReviewJobLease,
  supersedeReviewJob,
  type Database,
  type RetryPolicy,
  type ReviewJob,
} from "@pr-review/db";
import type { CheckRunOutput, GithubAppClient } from "@pr-review/github";
import { errorMessage, redact, withFields, type StructuredLogger } from "@pr-review/logging";
import {
  dashboardDelivery,
  githubDelivery,
  isFixCommit,
  reviewCorrelation,
  runReview,
  type ReviewTarget,
} from "@pr-review/reviewer";

import { supersedeForLiveHead } from "#src/head-repair";
import { createJobClient, type HostedClient } from "#src/job-client";
import { createDatabaseReviewPublisher, type WriteDatabaseRunner } from "#src/record-review";
import { redactingLogger } from "#src/redact";

export interface JobRunnerDeps {
  /** Single statements only: transactions go through `withWriteDatabase`. */
  database: Database;
  /** Opens a transaction-capable database for dashboard ingest and head-repair enqueue. */
  withWriteDatabase: WriteDatabaseRunner;
  github: Pick<GithubAppClient, "createInstallationToken">;
  /** Builds the job's GitHub client over its installation token; rebuilt when the token is refreshed. */
  createClient: (token: string) => HostedClient;
  /** The clock that ages the installation token; Date.now unless injected. */
  now?: () => number;
  createLanguageModel: (config: LanguageModelConfig) => ReviewModel;
  /** The key that opens stored model keys. */
  encryptionKey: Uint8Array;
  logger: StructuredLogger;
  /** Masks the job's token and model key in exported traces until the returned function runs. */
  traceSecrets?: (secrets: readonly (string | undefined)[]) => () => void;
  /** Where an owner adds a model key; undefined leaves the link out. */
  settingsUrl: (slug: string) => string | undefined;
  /** The lease is renewed every `heartbeatMs`, which is also how soon a superseded run stops. */
  lease: { leaseMs: number; heartbeatMs: number };
  retry: RetryPolicy;
  /** Review only the commits since the last reviewed one; on unless switched off. */
  incremental?: boolean | undefined;
}

export type JobOutcome = "succeeded" | "no-key" | "superseded" | "retrying" | "failed";

function noKeyOutput(slug: string, url: string | undefined): CheckRunOutput {
  const where = url ? `[Settings → Model key](${url})` : "Settings → Model key in the LintCat dashboard";
  return {
    title: "Add a model key to review this pull request",
    summary:
      `No model key is saved for **${slug}**, so no review ran and no model was called. ` +
      `An owner of the account can add one under ${where}, then push a commit or re-add the \`ai-review\` label.`,
  };
}

function unreadableKeyOutput(slug: string, url: string | undefined): CheckRunOutput {
  const where = url ? `[Settings → Model key](${url})` : "Settings → Model key in the LintCat dashboard";
  return {
    title: "The saved model key could not be read",
    summary:
      `The model key saved for **${slug}** could not be decrypted, so no review ran and no model was called. ` +
      `An owner of the account can re-add the key under ${where}, then push a commit or re-add the \`ai-review\` label.`,
  };
}

function failureOutput(attempts: number): CheckRunOutput {
  return {
    title: "The AI review could not finish",
    summary:
      `The review failed ${attempts === 1 ? "once" : `${attempts} times`} and will not be retried. ` +
      "Push a commit or re-add the `ai-review` label to try again.",
  };
}

const ATTEMPTS_EXHAUSTED = "stopped without finishing on every attempt";
const MODEL_KEY_UNREADABLE = "the stored model key could not be decrypted";

function attemptsExhaustedOutput(): CheckRunOutput {
  return {
    title: "The AI review could not finish",
    summary:
      "The review stopped without finishing on every attempt and will not be retried. " +
      "Push a commit or re-add the `ai-review` label to try again.",
  };
}

function unknownModelOutput(message: string): CheckRunOutput {
  return {
    title: "The chosen model is not recognized",
    summary:
      `${message} A repository owner can change the model in the repository's settings, ` +
      "then push a commit or re-add the `ai-review` label.",
  };
}

// Fixing our own fix commit would loop, so an unreadable head disables fixes.
async function fixesAllowed(
  client: HostedClient,
  target: ReviewTarget,
  logger: StructuredLogger,
): Promise<boolean> {
  try {
    const message = await client.getCommitMessage({
      owner: target.owner,
      repo: target.repo,
      sha: target.headSha,
    });
    if (!isFixCommit(message)) return true;
    logger.info("review.fixes.disabled", {
      ...reviewCorrelation(target),
      reason: "the head commit is this app's own fix",
    });
  } catch (error: unknown) {
    logger.error("review.fixes.disabled", {
      ...reviewCorrelation(target),
      reason: errorMessage(error),
    });
  }
  return false;
}

/** Runs one claimed job and settles its row; anything it throws has the job's secrets masked. */
export async function runReviewJob(deps: JobRunnerDeps, job: ReviewJob): Promise<JobOutcome> {
  const secrets: (string | undefined)[] = [];
  try {
    return await runJob(deps, job, secrets);
  } catch (error: unknown) {
    throw new Error(redact(errorMessage(error), secrets));
  }
}

async function runJob(
  deps: JobRunnerDeps,
  job: ReviewJob,
  secrets: (string | undefined)[],
): Promise<JobOutcome> {
  const { database, lease, retry } = deps;
  const noRetry = { ...retry, maxAttempts: 0 };
  const traceFields: { traceId?: string } = {};
  const logger = withFields(redactingLogger(deps.logger, secrets), traceFields);
  const context = await findReviewJobContext(database, job.repoId);
  const organization = context?.organization;
  const fields = { jobId: job.id, attempt: job.attempts };
  if (
    !context ||
    context.repo.removedAt ||
    !organization ||
    organization.installationId === null ||
    organization.uninstalledAt ||
    organization.suspendedAt
  ) {
    await failReviewJob(database, job, "the installation no longer covers this repository", noRetry);
    logger.info("review_job.dropped", { ...fields, reason: "not_installed" });
    return "failed";
  }

  const { installationId } = organization;
  let failure: string | undefined;
  const settle = async (): Promise<JobOutcome> => {
    const target: ReviewTarget = {
      owner: context.repo.owner,
      repo: context.repo.name,
      pullRequestNumber: job.prNumber,
      headSha: job.headSha,
    };
    const correlation = { ...fields, ...reviewCorrelation(target) };
    const controller = new AbortController();
    const stillRunning = async () => {
      const running = await renewReviewJobLease(database, job, lease.leaseMs);
      if (!running) controller.abort();
      return running;
    };
    const heartbeat = setInterval(() => {
      stillRunning().catch((error: unknown) =>
        logger.error("review_job.heartbeat_failed", { ...correlation, error: errorMessage(error) }),
      );
    }, lease.heartbeatMs);

    let client: HostedClient | undefined;
    const publishFailure = async (publisher: HostedClient, output: CheckRunOutput) => {
      await publisher
        .createCheckRun({
          owner: target.owner,
          repo: target.repo,
          headSha: target.headSha,
          conclusion: "neutral",
          output,
        })
        .catch((publishError: unknown) =>
          logger.error("review_job.failure_unpublished", {
            ...correlation,
            error: redact(errorMessage(publishError), secrets),
          }),
        );
    };
    // Ends the job without retry, unless the fence finds it already taken.
    const failOnce = async (
      publisher: HostedClient,
      reason: string,
      event: string,
      output: CheckRunOutput,
      extra: Record<string, unknown> = {},
    ): Promise<JobOutcome> => {
      failure = reason;
      if ((await failReviewJob(database, job, reason, noRetry)) === "superseded") return "superseded";
      logger.error(event, { ...correlation, ...extra });
      await publishFailure(publisher, output);
      return "failed";
    };
    try {
      client = await createJobClient({ ...deps, now: deps.now ?? Date.now }, installationId, secrets);

      const pullRequest = await client.getPullRequest(target);
      if (pullRequest.state !== "open") {
        await supersedeReviewJob(database, job);
        logger.info("review_job.superseded", { ...correlation, reason: "pr_closed" });
        return "superseded";
      }
      if (pullRequest.headSha !== job.headSha) {
        const { requeued } = await supersedeForLiveHead(deps.withWriteDatabase, job, pullRequest);
        logger.info("review_job.superseded", {
          ...correlation,
          reason: "head_moved",
          liveHeadSha: pullRequest.headSha,
          requeued,
        });
        return "superseded";
      }

      // Each earlier claim crashed without settling, so another run would too.
      if (job.attempts > retry.maxAttempts) {
        return await failOnce(client, ATTEMPTS_EXHAUSTED, "review_job.attempts_exhausted", attemptsExhaustedOutput(), {
          maxAttempts: retry.maxAttempts,
        });
      }

      const key = await readModelKey(database, organization.id, deps.encryptionKey).catch((error: unknown) => {
        if (error instanceof ModelKeyUnreadableError) return null;
        throw error;
      });
      // Retrying cannot open a key sealed under another encryption key.
      if (key === null) {
        const output = unreadableKeyOutput(organization.slug, deps.settingsUrl(organization.slug));
        return await failOnce(client, MODEL_KEY_UNREADABLE, "review_job.model_key_unreadable", output);
      }
      secrets.push(key?.apiKey);
      if (!key) {
        if (!(await stillRunning())) return "superseded";
        await client.createCheckRun({
          owner: target.owner,
          repo: target.repo,
          headSha: target.headSha,
          conclusion: "neutral",
          output: noKeyOutput(organization.slug, deps.settingsUrl(organization.slug)),
        });
        await completeReviewJob(database, job);
        logger.info("review_job.no_model_key", correlation);
        return "no-key";
      }

      const settings = await effectiveRepoSettings(database, context.repo.id);
      const provider = resolveModelProvider(key.provider);
      const modelId = resolveModelId(provider, settings.model ?? "");
      const model = deps.createLanguageModel({ provider, apiKey: key.apiKey, modelId });
      logger.info("review_job.started", {
        ...correlation,
        provider,
        model: model.modelId,
        fixes: settings.fixes,
      });
      const commitFixes = settings.fixes && (await fixesAllowed(client, target, logger));
      const delivery = dashboardDelivery(
        githubDelivery({ client, logger, commitFixes }),
        createDatabaseReviewPublisher(deps.withWriteDatabase, organization.id, logger),
        logger,
      );
      await runReview({
        client,
        target,
        delivery,
        engine: toolLoopEngine({ model }),
        policy: { incremental: deps.incremental ?? true },
        logger,
        signal: controller.signal,
        stillRunning,
      });
      if (!(await completeReviewJob(database, job))) return "superseded";
      logger.info("review_job.succeeded", correlation);
      return "succeeded";
    } catch (error: unknown) {
      if (controller.signal.aborted || isCancellation(error)) {
        logger.info("review_job.superseded", { ...correlation, reason: "newer_job" });
        return "superseded";
      }
      const message = redact(errorMessage(error), secrets);
      failure = message;
      // The same settings would fail every retry, so an unknown model gets none.
      const unknownModel = error instanceof ModelProviderError;
      const outcome = await failReviewJob(database, job, message, unknownModel ? noRetry : retry);
      if (outcome === "superseded") return "superseded";
      logger.error(`review_job.${outcome}`, { ...correlation, error: message });
      if (outcome === "failed" && client) {
        await publishFailure(client, unknownModel ? unknownModelOutput(message) : failureOutput(job.attempts));
      }
      return outcome;
    } finally {
      clearInterval(heartbeat);
    }
  };

  const untrace = deps.traceSecrets?.(secrets);
  try {
    return await traceStage("review-job", { ...fields, prNumber: job.prNumber, headSha: job.headSha }, settle, {
      output: (outcome) => ({ outcome, error: failure }),
      level: (outcome) => (outcome === "failed" ? "ERROR" : outcome === "retrying" ? "WARNING" : undefined),
      attributes: {
        sessionId: `${context.repo.owner}/${context.repo.name}#${job.prNumber}`,
        userId: organization.slug,
        metadata: { jobId: String(job.id), attempt: String(job.attempts), headSha: job.headSha },
      },
      onTraceId: (traceId) => {
        traceFields.traceId = traceId;
      },
    });
  } finally {
    untrace?.();
  }
}
