/** The shared shapes between the review agents and the orchestrator. */
import type { ChangedFile, PullRequestDetails } from "@pr-review/github";

/** Which of a pull request's files a review reads. */
export interface ReviewScope {
  /** The files under review: every file the pull request changed, or only those since `sinceSha`. */
  changedFiles: readonly ChangedFile[];
  pullRequestFiles: readonly ChangedFile[];
  /** Set when an earlier review already read the pull request up to this commit. */
  sinceSha?: string | undefined;
}

/** Everything loaded about a PR before any agent runs. */
export interface ReviewContext extends ReviewScope {
  owner: string;
  repo: string;
  pullRequest: PullRequestDetails;
  /** Aborts this review's model calls; absent means the run cannot be cancelled. */
  signal?: AbortSignal | undefined;
}

/**
 * One review agent. `run` resolves with untrusted candidate findings
 * that must pass validateFindings before anything reaches GitHub.
 */
export interface ReviewAgent {
  name: string;
  run(context: ReviewContext): Promise<readonly unknown[]>;
}
