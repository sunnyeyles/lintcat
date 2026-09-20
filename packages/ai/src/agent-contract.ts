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

/** One agent's step through a run, mirroring the runtime's agent.* log events. */
export interface AgentLifecycleEvent {
  agent: string;
  phase: "started" | "completed" | "failed";
  /** Agents that have finished, out of the run's total. */
  finished: number;
  total: number;
}

/** Observes agent progress; its own failures never reach the review. */
export type AgentLifecycleListener = (event: AgentLifecycleEvent) => void;

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
