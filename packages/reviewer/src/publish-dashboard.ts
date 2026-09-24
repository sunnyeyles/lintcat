import type { ReviewRecord } from "@pr-review/schemas";

import type { ReviewTarget } from "#src/review-target";

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
