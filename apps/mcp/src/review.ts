import type { AgentLifecycleListener } from "@pr-review/ai";
import {
  githubDelivery,
  recordingDelivery,
  runReview as runAssembledReview,
  type GithubDeliveryConfig,
  type ReviewClient,
  type ReviewDelivery,
  type ReviewOutcome,
  type ReviewTarget,
} from "@pr-review/reviewer";

import { resolveModel, type McpEnvironment } from "#src/environment";

export interface ReviewRequest {
  client: ReviewClient;
  target: ReviewTarget;
  /** Agent configuration is read here, never at the head. */
  baseSha: string;
  /** Comma-separated agent categories; empty runs the configured set. */
  agents?: string | undefined;
  index?: boolean | undefined;
  /** Where the run writes back; absent is a dry run, and a local checkout has nothing to pass. */
  publishTo?: GithubDeliveryConfig["client"] | undefined;
  /** The caller's cancellation, as the MCP request handler receives it. */
  signal?: AbortSignal | undefined;
  /** Reports each agent's start and finish while the review runs. */
  onAgentEvent?: AgentLifecycleListener | undefined;
}

export interface ReviewResult {
  outcome: ReviewOutcome;
  agents: string[];
  /** The check-run text the Action would have published. */
  summary: string;
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
    baseSha,
    agents: selection = "",
    index = true,
    publishTo,
    signal,
    onAgentEvent,
  }: ReviewRequest,
): Promise<ReviewResult> {
  const { logger } = environment;
  const { model, createModel } = resolveModel(environment);

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
    agents: { readAt: baseSha, select: selection },
    engine: { model, createModel },
    policy: { index },
    logger,
    signal,
    onAgentEvent,
  });
  return {
    outcome: run.outcome,
    agents: run.agents.map((agent) => agent.category),
    summary,
  };
}
