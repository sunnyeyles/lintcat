/** Whether a repo's settings ask for an open pull request to be reviewed right now. */
import type { RepoReviewMode } from "./schema";

/** Adding this label to a pull request asks for a hosted review in `label` mode. */
export const REVIEW_LABEL = "ai-review";

export function reviewsPullRequestNow(
  mode: RepoReviewMode,
  labels: readonly string[],
): boolean {
  switch (mode) {
    case "off":
      return false;
    case "every_pr":
      return true;
    case "label":
      return labels.includes(REVIEW_LABEL);
  }
}
