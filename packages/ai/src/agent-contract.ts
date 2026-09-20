/** The shared shapes between the review agents and the orchestrator. */
import type { ChangedFile, PullRequestDetails } from "@pr-review/github";

/** The whole pull request, when `diff` is narrowed. */
export interface IncrementalReview {
  sinceSha: string;
  diff: string;
  changedFiles: readonly ChangedFile[];
}

/** Everything loaded about a PR before any agent runs. */
export interface ReviewContext {
  owner: string;
  repo: string;
  pullRequest: PullRequestDetails;
  changedFiles: readonly ChangedFile[];
  diff: string;
  incremental?: IncrementalReview | undefined;
  /** Aborts this review's model calls; absent means the run cannot be cancelled. */
  signal?: AbortSignal | undefined;
}

/**
 * One review agent. `run` resolves with untrusted candidate findings
 * that must pass validateFindings before anything reaches GitHub.
 */
export interface ReviewAgent {
  name: string;
  /** Running alone, its findings need no synthesis. */
  standalone?: boolean;
  run(context: ReviewContext): Promise<readonly unknown[]>;
}
