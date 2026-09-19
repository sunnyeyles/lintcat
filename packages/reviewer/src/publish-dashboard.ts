import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import type { ReviewRecord } from "@pr-review/schemas";

import { reviewCorrelation, type ReviewTarget } from "#src/review-target";

/** What one review contributes to the dashboard; the target supplies the rest. */
export type DashboardReview = Omit<
  ReviewRecord,
  "owner" | "repo" | "prNumber" | "headSha"
>;

/** Sends one review to the dashboard. Never throws, never rejects. */
export type PublishToDashboard = (
  target: ReviewTarget,
  review: DashboardReview,
) => Promise<void>;

export interface DashboardPublisherConfig {
  /** Dashboard base URL; `/api/ingest` is appended to it. */
  baseUrl: string;
  /** The team's ingest secret, sent as a bearer token. */
  token: string;
  fetch?: typeof globalThis.fetch | undefined;
  logger: StructuredLogger;
}

async function bodyText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch (error) {
    return errorMessage(error);
  }
}

async function reviewIdOf(response: Response): Promise<unknown> {
  try {
    return ((await response.json()) as { reviewId?: unknown }).reviewId;
  } catch {
    return undefined;
  }
}

/** Mirrors the review to the dashboard; reporting is not reviewing, so failures are only logged. */
export function createDashboardPublisher({
  baseUrl,
  token,
  fetch = globalThis.fetch,
  logger,
}: DashboardPublisherConfig): PublishToDashboard {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/ingest`;
  return async (target, review) => {
    const fields = reviewCorrelation(target);
    const record: ReviewRecord = {
      owner: target.owner,
      repo: target.repo,
      prNumber: target.pullRequestNumber,
      headSha: target.headSha,
      ...review,
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(record),
      });
      if (!response.ok) {
        logger.error("dashboard.publish_failed", {
          ...fields,
          status: response.status,
          error: await bodyText(response),
        });
        return;
      }
      logger.info("dashboard.published", {
        ...fields,
        reviewId: await reviewIdOf(response),
      });
    } catch (error) {
      logger.error("dashboard.publish_failed", {
        ...fields,
        error: errorMessage(error),
      });
    }
  };
}
