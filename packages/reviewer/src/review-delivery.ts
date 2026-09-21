/**
 * Delivery: the one seam a review run writes through. GitHub, the dashboard
 * and publishing nothing at all are adapters here.
 */
import type { AgentDefinition, AgentUsageReport } from "@pr-review/ai";
import type {
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "@pr-review/github";
import {
  encodeRepositoryGraph,
  type RepositoryGraphSnapshot,
} from "@pr-review/index";
import type { StructuredLogger } from "@pr-review/logging";
import type {
  ReviewRecordChangedFile,
  ReviewRecordGraph,
} from "@pr-review/schemas";

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
  /** The run's agent set, in configured order. */
  agents: readonly AgentDefinition[];
  /** One entry per agent that ran, in the same order. */
  usage: readonly AgentUsageReport[];
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

const RECORDED_STATUSES = new Set(["added", "modified", "removed", "renamed"]);

// GitHub's copied, changed and unchanged have no status of their own here.
function recordedStatus(status: string): ReviewRecordChangedFile["status"] {
  return RECORDED_STATUSES.has(status)
    ? (status as ReviewRecordChangedFile["status"])
    : "modified";
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
  const names = usage.map((report) => report.agent);
  const count = outcome.findings.length;
  return {
    baseSha: outcome.baseSha,
    changedFiles: outcome.changedFiles.map((file) => ({
      path: file.filename,
      status: recordedStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
    })),
    ...(outcome.graph === undefined ? {} : { graph: graphPayload(outcome.graph) }),
    agents: names,
    summary: `${count === 1 ? "1 finding" : `${count} findings`} from ${names.join(", ") || "no agent"}`,
    durationMs,
    agentRuns: usage.map((report) => ({
      agent: report.agent,
      durationMs: report.durationMs,
      findingCount: outcome.findings.filter(
        (finding) => finding.category === report.agent,
      ).length,
      ...report.usage,
    })),
    findings: outcome.findings.map((finding) => ({
      ...finding,
      agent: finding.category,
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
