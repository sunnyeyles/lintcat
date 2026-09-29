import type { ReviewPolicy } from "#src/review-run";

/** How CI reviews a pull request; the worker and a local `--profile ci` both run it, with no memory. */
export const CI_REVIEW_POLICY = {
  incremental: true,
  index: true,
  suggestReviewers: true,
} as const satisfies Required<ReviewPolicy>;
