/**
 * One claimed review job, end to end: mint a token, open the key, run the
 * review, and settle the row.
 */
import {
  isCancellation,
  ModelProviderError,
  resolveModelId,
  resolveModelProvider,
  ReviewCancelledError,
  type LanguageModelConfig,
  type ReviewModel,
} from "@pr-review/ai";
import {
  completeReviewJob,
  effectiveRepoSettings,
  failReviewJob,
  findReviewJobContext,
  readModelKey,
  renewReviewJobLease,
  supersedeReviewJob,
  type Database,
  type RetryPolicy,
  type ReviewJob,
} from "@pr-review/db";
import type {
  CheckRunOutput,
  GithubAppClient,
  PullRequestReadClient,
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "@pr-review/github";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import {
  dashboardDelivery,
  githubDelivery,
  isFixCommit,
  reviewCorrelation,
  runReview,
  type PublishFixes,
  type ReviewDelivery,
  type ReviewTarget,
} from "@pr-review/reviewer";

import { createDatabaseReviewPublisher } from "#src/record-review";
import { redact, redactingLogger } from "#src/redact";

type HostedClient = PullRequestReadClient & RepositoryHistoryClient & ReviewPublishClient;

export interface JobRunnerDeps {
  /** Single statements only: the worker never needs a transaction. */
  database: Database;
  github: Pick<GithubAppClient, "createInstallationToken">;
  /** Builds the job's GitHub client over its installation token. */
  createClient: (token: string) => HostedClient;
  createLanguageModel: (config: LanguageModelConfig) => ReviewModel;
  /** The key that opens stored model keys. */
  encryptionKey: Uint8Array;
  logger: StructuredLogger;
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

function failureOutput(attempts: number): CheckRunOutput {
  return {
    title: "The AI review could not finish",
    summary:
      `The review failed ${attempts === 1 ? "once" : `${attempts} times`} and will not be retried. ` +
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

/** Throws before each publish once the job stops running, so a superseded run writes nothing. */
function guardedDelivery(to: ReviewDelivery, stillRunning: () => Promise<boolean>): ReviewDelivery {
  const guard = async () => {
    if (!(await stillRunning())) throw new ReviewCancelledError();
  };
  return {
    publishCheckRun: async (target, rendered) => {
      await guard();
      await to.publishCheckRun(target, rendered);
    },
    publishComments: async (target, rendered) => {
      await guard();
      return to.publishComments(target, rendered);
    },
    ...(to.publishFixes === undefined
      ? {}
      : {
          publishFixes: (async (target, input) => {
            await guard();
            return to.publishFixes!(target, input);
          }) satisfies PublishFixes,
        }),
    ...(to.publishRun === undefined ? {} : { publishRun: to.publishRun }),
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

/** Runs one claimed job and settles its row; never throws for a review failure. */
export async function runReviewJob(deps: JobRunnerDeps, job: ReviewJob): Promise<JobOutcome> {
  const { database, lease, retry } = deps;
  const secrets: (string | undefined)[] = [];
  const logger = redactingLogger(deps.logger, secrets);
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
    await failReviewJob(database, job.id, "the installation no longer covers this repository", {
      ...retry,
      maxAttempts: 0,
    });
    logger.info("review_job.dropped", { ...fields, reason: "not_installed" });
    return "failed";
  }

  const target: ReviewTarget = {
    owner: context.repo.owner,
    repo: context.repo.name,
    pullRequestNumber: job.prNumber,
    headSha: job.headSha,
  };
  const correlation = { ...fields, ...reviewCorrelation(target) };
  const controller = new AbortController();
  const stillRunning = async () => {
    const running = await renewReviewJobLease(database, job.id, lease.leaseMs);
    if (!running) controller.abort();
    return running;
  };
  const heartbeat = setInterval(() => {
    stillRunning().catch((error: unknown) =>
      logger.error("review_job.heartbeat_failed", { ...correlation, error: errorMessage(error) }),
    );
  }, lease.heartbeatMs);

  let client: HostedClient | undefined;
  try {
    const token = await deps.github.createInstallationToken(organization.installationId);
    secrets.push(token);
    client = deps.createClient(token);

    const pullRequest = await client.getPullRequest(target);
    if (pullRequest.headSha !== job.headSha) {
      await supersedeReviewJob(database, job.id);
      logger.info("review_job.superseded", { ...correlation, reason: "head_moved" });
      return "superseded";
    }

    const key = await readModelKey(database, organization.id, deps.encryptionKey);
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
      await completeReviewJob(database, job.id);
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
      createDatabaseReviewPublisher(database, organization.id, logger),
    );
    await runReview({
      client,
      target,
      delivery: guardedDelivery(delivery, stillRunning),
      engine: { model },
      policy: { incremental: deps.incremental ?? true },
      logger,
      signal: controller.signal,
    });
    if (!(await completeReviewJob(database, job.id))) return "superseded";
    logger.info("review_job.succeeded", correlation);
    return "succeeded";
  } catch (error: unknown) {
    if (controller.signal.aborted || isCancellation(error)) {
      logger.info("review_job.superseded", { ...correlation, reason: "newer_job" });
      return "superseded";
    }
    const message = redact(errorMessage(error), secrets);
    // The same settings would fail every retry, so an unknown model gets none.
    const unknownModel = error instanceof ModelProviderError;
    const outcome = await failReviewJob(
      database,
      job.id,
      message,
      unknownModel ? { ...retry, maxAttempts: 0 } : retry,
    );
    if (outcome === "superseded") return "superseded";
    logger.error(`review_job.${outcome}`, { ...correlation, error: message });
    if (outcome === "failed" && client) {
      await client
        .createCheckRun({
          owner: target.owner,
          repo: target.repo,
          headSha: target.headSha,
          conclusion: "failure",
          output: unknownModel ? unknownModelOutput(message) : failureOutput(job.attempts),
        })
        .catch((publishError: unknown) =>
          logger.error("review_job.failure_unpublished", {
            ...correlation,
            error: redact(errorMessage(publishError), secrets),
          }),
        );
    }
    return outcome;
  } finally {
    clearInterval(heartbeat);
  }
}
