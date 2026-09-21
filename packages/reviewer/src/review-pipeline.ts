/** The review pipeline: one agent runs, then its candidates are validated. */
import {
  isCancellation,
  ReviewCancelledError,
  throwIfCancelled,
  type ReviewAgent,
  type ReviewContext,
} from "@pr-review/ai";
import type { ReviewFinding } from "@pr-review/schemas";

import { validateFindings } from "#src/validate-findings";

/** The full outcome of one review-pipeline run, for the caller to log and publish. */
export interface ReviewPipelineResult {
  /** Untrusted candidate findings the agent proposed. */
  candidates: unknown[];
  /** The final, deterministically validated findings. */
  findings: ReviewFinding[];
}

/** Throws when the agent failed or the run was cancelled. */
export async function runReviewPipeline(
  agent: ReviewAgent,
  context: ReviewContext,
): Promise<ReviewPipelineResult> {
  throwIfCancelled(context.signal);
  let candidates: unknown[];
  try {
    candidates = [...(await agent.run(context))];
  } catch (error) {
    if (isCancellation(error, context.signal)) {
      throw new ReviewCancelledError();
    }
    throw error;
  }
  throwIfCancelled(context.signal);

  return {
    candidates,
    findings: validateFindings(candidates, context.changedFiles, [agent.name]),
  };
}
