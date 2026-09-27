/**
 * Delivery: the one seam a review run writes through. GitHub, the dashboard
 * and publishing nothing at all are adapters here.
 */
import type { TokenUsage } from "@pr-review/ai";
import type {
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "@pr-review/github";
import type { StructuredLogger } from "@pr-review/logging";
import type { ReviewRecord } from "@pr-review/schemas";

import {
  createCheckRunPublisher,
  createFixPublisher,
  createReviewCommentPublisher,
  type PublishFixes,
  type PublishReview,
  type PublishReviewComments,
} from "#src/publish-review";
import type { RenderedCheckRun } from "#src/render-check-run";
import type { RenderedReview } from "#src/render-review";
import { buildReviewRecord } from "#src/review-record";
import type { ReviewOutcome } from "#src/review-run";
import type { ReviewTarget } from "#src/review-target";

/** One finished run, for anything that mirrors runs rather than reviews. */
export interface FinishedReviewRun {
  outcome: ReviewOutcome;
  /** Tokens the run's model calls spent. */
  usage: TokenUsage;
  durationMs: number;
}

/** Mirrors a finished run somewhere that is not the pull request. */
export type PublishReviewRun = (
  target: ReviewTarget,
  run: FinishedReviewRun,
) => Promise<void>;

/**
 * Where a run's output goes. Supplying `publishFixes` is the only way to ask
 * for a fix commit, so an adapter that cannot commit cannot be asked to.
 */
export interface ReviewDelivery {
  publishCheckRun: PublishReview;
  publishComments: PublishReviewComments;
  publishFixes?: PublishFixes | undefined;
  publishRun?: PublishReviewRun | undefined;
}

export interface GithubDeliveryConfig {
  client: RepositoryHistoryClient & ReviewPublishClient;
  logger: StructuredLogger;
  /** On, verified patches are committed to the head branch. */
  commitFixes?: boolean | undefined;
}

/** The production delivery: a check run, inline comments, optionally a commit. */
export function githubDelivery({
  client,
  logger,
  commitFixes = false,
}: GithubDeliveryConfig): ReviewDelivery {
  return {
    publishCheckRun: createCheckRunPublisher(client),
    publishComments: createReviewCommentPublisher(client, logger),
    ...(commitFixes
      ? { publishFixes: createFixPublisher(client, logger) }
      : {}),
  };
}

/** What a recording delivery kept instead of publishing it. */
export interface RecordedDelivery {
  checkRun: RenderedCheckRun | undefined;
  review: RenderedReview | undefined;
  runs: FinishedReviewRun[];
}

export interface RecordingDelivery {
  delivery: ReviewDelivery;
  /** Filled as the run publishes; read it after the run returns. */
  recorded: RecordedDelivery;
}

/**
 * Publishes nothing. It closes over no client, so a run wired to it has
 * nothing to write through, whatever it asks for.
 */
export function recordingDelivery(): RecordingDelivery {
  const recorded: RecordedDelivery = {
    checkRun: undefined,
    review: undefined,
    runs: [],
  };
  return {
    recorded,
    delivery: {
      publishCheckRun: async (_target, rendered) => {
        recorded.checkRun = rendered;
      },
      // No comment surface, so the check run keeps the annotations.
      publishComments: async (_target, rendered) => {
        recorded.review = rendered;
        return "unavailable";
      },
      publishRun: async (_target, run) => {
        recorded.runs.push(run);
      },
    },
  };
}

/** Sends one review record to the dashboard. Never throws, never rejects. */
export type PublishToDashboard = (
  target: ReviewTarget,
  record: ReviewRecord,
) => Promise<void>;

/** Mirrors every finished run to the dashboard, on top of another delivery. */
export function dashboardDelivery(
  to: ReviewDelivery,
  publish: PublishToDashboard,
  logger: StructuredLogger,
): ReviewDelivery {
  return {
    ...to,
    publishRun: async (target, run) => {
      await to.publishRun?.(target, run);
      await publish(target, buildReviewRecord(target, run, logger));
    },
  };
}
