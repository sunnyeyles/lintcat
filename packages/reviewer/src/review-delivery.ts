/**
 * Delivery: the one seam a review run writes through. GitHub, the dashboard
 * and publishing nothing at all are adapters here.
 */
import type { TokenUsage } from "@pr-review/ai";
import type {
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "@pr-review/github";
import {
  encodeRepositoryGraph,
  type RepositoryGraphSnapshot,
} from "@pr-review/index";
import type { StructuredLogger } from "@pr-review/logging";
import type { ReviewRecordGraph } from "@pr-review/schemas";

import { changeStatus } from "#src/blast-radius";
import type { DashboardReview, PublishToDashboard } from "#src/publish-dashboard";
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
import type { ReviewOutcome } from "#src/review-pull-request";
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

/** The snapshot as the ingest payload carries it: base64 of gzipped JSON. */
function graphPayload(snapshot: RepositoryGraphSnapshot): ReviewRecordGraph {
  return {
    gzip: Buffer.from(encodeRepositoryGraph(snapshot)).toString("base64"),
    fileCount: snapshot.files.length,
    edgeCount: snapshot.edges.length,
  };
}

/** What one finished run contributes to the dashboard. */
export function dashboardReview({
  outcome,
  usage,
  durationMs,
}: FinishedReviewRun): DashboardReview {
  const count = outcome.findings.length;
  return {
    summary: count === 1 ? "1 finding" : `${count} findings`,
    durationMs,
    baseSha: outcome.baseSha,
    changedFiles: outcome.changedFiles.map((file) => ({
      path: file.filename,
      status: changeStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
    })),
    ...(outcome.graph === undefined ? {} : { graph: graphPayload(outcome.graph) }),
    ...usage,
    // The patch is verbatim source, so the dashboard learns only that one survived.
    findings: outcome.findings.map(({ patch, ...finding }) => ({
      ...finding,
      hasPatch: patch !== undefined,
    })),
  };
}

/** Mirrors every finished run to the dashboard, on top of another delivery. */
export function dashboardDelivery(
  to: ReviewDelivery,
  publish: PublishToDashboard,
): ReviewDelivery {
  return {
    ...to,
    publishRun: async (target, run) => {
      await to.publishRun?.(target, run);
      await publish(target, dashboardReview(run));
    },
  };
}
