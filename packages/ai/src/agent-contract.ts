/** The shared shapes between the review agents and the orchestrator. */
import type { ChangedFile, PullRequestDetails } from "@pr-review/github";

/** The whole pull request, when `diff` covers only part of it. */
export interface IncrementalReview {
  /** The commit an earlier review of this pull request already read. */
  sinceSha: string;
  diff: string;
  changedFiles: readonly ChangedFile[];
}

/** Everything loaded about a PR before any agent runs. */
export interface ReviewContext {
  owner: string;
  repo: string;
  pullRequest: PullRequestDetails;
  /** What this review covers: the whole PR, or the commits since an earlier one. */
  changedFiles: readonly ChangedFile[];
  diff: string;
  /** Set when `diff` was narrowed; the tools still serve the whole PR. */
  incremental?: IncrementalReview | undefined;
}

/**
 * One review agent. `run` resolves with untrusted candidate findings
 * that must pass validateFindings before anything reaches GitHub.
 */
export interface ReviewAgent {
  name: string;
  run(context: ReviewContext): Promise<readonly unknown[]>;
}
