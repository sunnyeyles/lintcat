import {
  createSynthesiser,
  loadAgentDefinitions,
  resolveAgentDefinitions,
} from "@pr-review/ai";
import type { GithubInstallationClient } from "@pr-review/github";
import {
  createCheckRunPublisher,
  createPipelineRunner,
  readAtCommit,
  reviewPullRequest,
  type PublishReview,
  type ReviewOutcome,
  type ReviewTarget,
} from "@pr-review/reviewer";

import { resolveModel, type McpEnvironment } from "#src/environment";

export interface ReviewRequest {
  client: GithubInstallationClient;
  target: ReviewTarget;
  /** Agent configuration is read here, never at the head. */
  baseSha: string;
  /** Comma-separated agent categories; empty runs the configured set. */
  agents?: string | undefined;
  index?: boolean | undefined;
  /** False keeps every GitHub write a no-op. */
  publish: boolean;
  /** The caller's cancellation, as the MCP request handler receives it. */
  signal?: AbortSignal | undefined;
}

export interface ReviewResult {
  outcome: ReviewOutcome;
  agents: string[];
  /** The check-run text the Action would have published. */
  summary: string;
}

export async function runReview(
  environment: McpEnvironment,
  {
    client,
    target,
    baseSha,
    agents: selection = "",
    index = true,
    publish,
    signal,
  }: ReviewRequest,
): Promise<ReviewResult> {
  const { logger } = environment;
  const configured = await loadAgentDefinitions({
    readFile: readAtCommit(client, target, baseSha),
  });
  const agents = resolveAgentDefinitions(selection, configured);
  const { model, createModel } = resolveModel(environment);

  let summary = "";
  const checkRun = publish ? createCheckRunPublisher(client) : undefined;
  const publishReview: PublishReview = async (reviewed, rendered) => {
    const { title, summary: body, text } = rendered.output;
    summary = [`## ${title}`, body, text].filter(Boolean).join("\n\n");
    await checkRun?.(reviewed, rendered);
  };

  const outcome = await reviewPullRequest(target, {
    client,
    agents,
    index,
    logger,
    runReviewPipeline: createPipelineRunner({
      model,
      createModel,
      synthesiser: createSynthesiser({ model, agents }),
      logger,
    }),
    publishReview,
    signal,
    ...(publish ? {} : { publishReviewComments: async () => "unavailable" as const }),
  });
  return { outcome, agents: agents.map((agent) => agent.category), summary };
}
