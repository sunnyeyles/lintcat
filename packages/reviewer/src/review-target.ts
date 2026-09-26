import type { PullRequestRef } from "@pr-review/github";

export { reviewCorrelation } from "@pr-review/github";

/** The pull request one review runs against, at one commit. */
export interface ReviewTarget extends PullRequestRef {
  headSha: string;
}
