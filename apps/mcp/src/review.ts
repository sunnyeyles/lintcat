import {
  githubDelivery,
  recordingDelivery,
  runReview as runAssembledReview,
  type GithubDeliveryConfig,
  type MemoryStore,
  type ReviewClient,
  type ReviewDelivery,
  type ReviewOutcome,
  type ReviewTarget,
} from "@pr-review/reviewer";

import type { McpEnvironment } from "#src/environment";
import type { SelectedEngine } from "#src/review-engine";

export interface ReviewRequest {
  client: ReviewClient;
  target: ReviewTarget;
  /** What runs the review; chosen by the caller. */
  selected: SelectedEngine;
  index?: boolean | undefined;
  /** Where the run writes back; absent is a dry run, and a local checkout has nothing to pass. */
  publishTo?: GithubDeliveryConfig["client"] | undefined;
  /** The memory whose hints and suppressions this run consults; absent reads none. */
  memory?: MemoryStore | undefined;
  /** Aborting it stops the agent, and a cancelled run publishes nothing. */
  signal?: AbortSignal | undefined;
}

export interface ReviewResult {
  outcome: ReviewOutcome;
  /** The check-run text the App would have published. */
  summary: string;
  /** The reduced review ran: one sampling request instead of the tool loop. */
  singleShot: boolean;
}

/** Captures the check-run text on its way through, publishing or not. */
function capturingSummary(
  to: ReviewDelivery,
  capture: (summary: string) => void,
): ReviewDelivery {
  return {
    ...to,
    publishCheckRun: async (target, rendered) => {
      const { title, summary, text } = rendered.output;
      capture([`## ${title}`, summary, text].filter(Boolean).join("\n\n"));
      await to.publishCheckRun(target, rendered);
    },
  };
}

export async function runReview(
  environment: McpEnvironment,
  {
    client,
    target,
    selected,
    index = true,
    publishTo,
    memory,
    signal,
  }: ReviewRequest,
): Promise<ReviewResult> {
  const { logger } = environment;
  let summary = "";
  const run = await runAssembledReview({
    client,
    target,
    delivery: capturingSummary(
      publishTo === undefined
        ? recordingDelivery().delivery
        : githubDelivery({ client: publishTo, logger }),
      (captured) => {
        summary = captured;
      },
    ),
    engine: selected.engine,
    policy: { index },
    ...(memory === undefined ? {} : { memory: { store: memory } }),
    logger,
    signal,
  });
  return {
    outcome: run.outcome,
    summary,
    singleShot: selected.singleShot,
  };
}
