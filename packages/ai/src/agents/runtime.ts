/**
 * The shared review-agent runtime — the tool loop every agent runs. An
 * AgentDefinition supplies role, focus and category; the rest is identical.
 */
import { startActiveObservation } from "@langfuse/tracing";
import { reviewCorrelation } from "@pr-review/github";
import type { RepositoryIndex } from "@pr-review/index";
import {
  createConsoleLogger,
  errorMessage,
  errorName,
  type StructuredLogger,
} from "@pr-review/logging";
import { generateText, isStepCount, type ModelMessage } from "ai";

import {
  buildReviewSystemPrompt,
  type AgentDefinition,
} from "#src/agents/definition";
import {
  acceptAgentOutput,
  AgentRunError,
  extractAgentOutput,
} from "#src/agents/output";
import type { ReviewModel } from "#src/model";
import type { ReviewAgent, ReviewContext } from "#src/agent-contract";
import { isCancellation } from "#src/cancellation";
import { loadHeadImports } from "#src/agents/head-imports";
import {
  buildOpeningMessage,
  type OpeningMessageLimits,
} from "#src/agents/opening-message";
import { createReviewTools, type ReviewToolsClient } from "#src/agents/tools";
import {
  addTokenUsage,
  emptyTokenUsage,
  toTokenUsage,
  type TokenUsage,
} from "#src/usage";

/** One agent run's spend, reported on success and on failure alike. */
export interface AgentUsageReport {
  agent: string;
  durationMs: number;
  steps: number;
  salvaged: boolean;
  usage: TokenUsage;
}

export { AgentRunError };

/** Model-call round trips before the agent is declared failed. */
const DEFAULT_MAX_TURNS = 12;

/** Output budget per model call (response text + tool requests). */
const MAX_OUTPUT_TOKENS = 16_000;

const OPENING_LIMITS: OpeningMessageLimits = {
  maxListedFiles: 300,
  maxDescriptionChars: 4_000,
  descriptionMarker: "\n[... description truncated; get_pull_request returns it whole]",
};

/** Anthropic honours this on a message and at call level; OpenAI ignores it. */
const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
};

function callProviderOptions(context: ReviewContext, category: string) {
  const { owner, repo, pullRequest } = context;
  return {
    ...CACHE_BREAKPOINT,
    openai: {
      promptCacheKey: `pr-review:${owner}/${repo}:${pullRequest.number}:${pullRequest.headSha.slice(0, 12)}:${category}`,
    },
  };
}

/** Sent on the final allowed turn, with tool use switched off. */
const FINAL_TURN_NUDGE =
  "This is your last turn and tools are no longer available. Return the findings JSON now, from what you have already read.";

function repairNudge(error: string): string {
  return `Your last message was not valid findings JSON (${error}). Reply with only the JSON object described under Output.`;
}

function scopeNote(context: ReviewContext): string[] {
  const { incremental } = context;
  if (incremental === undefined) {
    return [];
  }
  return [
    `<review_scope since="${incremental.sinceSha}">`,
    `The diff below covers only the commits added since ${incremental.sinceSha}, which an earlier review already read.`,
    `Report findings on these changes alone. The whole pull request (${incremental.changedFiles.length} file(s)) is still available through list_changed_files and get_diff.`,
    "</review_scope>",
    "",
  ];
}

/** What every review agent needs, regardless of agent. */
export interface ReviewAgentDeps {
  model: ReviewModel;
  github: ReviewToolsClient;
  maxTurns?: number | undefined;
  /** Receives agent.started / agent.completed / agent.failed. */
  logger?: StructuredLogger | undefined;
  onUsage?: ((report: AgentUsageReport) => void) | undefined;
  /** The repository at the base commit; absent when off, failed or unbuilt. */
  index?: RepositoryIndex | undefined;
}

/**
 * Builds one review agent: the given agent over the shared runtime,
 * with its tools bound to one installation's GitHub client.
 */
export function createReviewAgent(
  agent: AgentDefinition,
  deps: ReviewAgentDeps,
): ReviewAgent {
  const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
  const systemPrompt = buildReviewSystemPrompt(agent);
  const logger = deps.logger ?? createConsoleLogger();
  const model = deps.model;

  return {
    name: agent.category,

    async run(context: ReviewContext): Promise<readonly unknown[]> {
      // Every event of this run carries these fields.
      const eventFields = {
        ...reviewCorrelation({
          owner: context.owner,
          repo: context.repo,
          pullRequestNumber: context.pullRequest.number,
          headSha: context.pullRequest.headSha,
        }),
        agent: agent.category,
      };
      logger.info("agent.started", eventFields);
      const startedAt = Date.now();
      // Outside the try: a mid-loop API error still reports its spend.
      let usage = emptyTokenUsage();
      let steps = 0;
      let salvaged = false;
      const report = (durationMs: number): AgentUsageReport => ({
        agent: agent.category,
        durationMs,
        steps,
        salvaged,
        usage,
      });

      // Active, not detached: the SDK's model spans nest under this one, so
      // their cost lands on the agent trace instead of a trace of its own.
      return startActiveObservation(
        `review-agent-${agent.category}`,
        async (agentObservation) => {
          agentObservation.update({
            input: {
              repository: eventFields.repository,
              pullRequestNumber: eventFields.pullRequestNumber,
              headSha: eventFields.headSha,
              changedFileCount: context.changedFiles.length,
            },
            metadata: {
              agent: agent.category,
              provider: model.provider,
              model: model.modelId,
            },
          });

          try {
            const call = {
              model,
              abortSignal: context.signal,
              // The system breakpoint pins the shared prefix, tools included;
              // the call-level one below follows the growing tail.
              instructions: {
                role: "system" as const,
                content: systemPrompt,
                providerOptions: CACHE_BREAKPOINT,
              },
              tools: createReviewTools(deps.github, context, deps.index),
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              providerOptions: callProviderOptions(context, agent.category),
              telemetry: { functionId: `review-agent-${agent.category}` },
              onStepEnd: (step: { usage: Parameters<typeof toTokenUsage>[0] }) => {
                steps += 1;
                usage = addTokenUsage(usage, toTokenUsage(step.usage));
              },
            };
            const opening: ModelMessage = {
              role: "user",
              content: buildOpeningMessage(context, OPENING_LIMITS, {
                index: deps.index,
                headImports: await loadHeadImports(deps.github, context, deps.index),
                scopeNote: scopeNote(context),
              }),
            };

            const result = await generateText({
              ...call,
              messages: [opening],
              stopWhen: isStepCount(maxTurns),
              prepareStep: ({ stepNumber, messages }) => {
                if (stepNumber !== maxTurns - 1) {
                  return undefined;
                }
                salvaged = true;
                return {
                  toolChoice: "none" as const,
                  messages: [...messages, { role: "user", content: FINAL_TURN_NUDGE }],
                };
              },
            });

            // The SDK stops silently at the cap, still holding tool calls.
            if (result.finishReason === "tool-calls") {
              throw new AgentRunError(
                `${agent.category} agent exceeded the ${maxTurns}-turn cap without returning findings`,
              );
            }

            let output = extractAgentOutput(result.text);
            let repairStopReason: string | undefined;
            if (!output.ok) {
              const repaired = await generateText({
                ...call,
                messages: [
                  opening,
                  ...result.response.messages,
                  { role: "user", content: repairNudge(output.error) },
                ],
                toolChoice: "none",
                stopWhen: isStepCount(1),
              });
              repairStopReason = repaired.rawFinishReason ?? "unknown";
              output = extractAgentOutput(repaired.text);
            }
            const findings = acceptAgentOutput(
              agent.category,
              output,
              (error) =>
                `${agent.category} agent produced invalid findings output after one repair turn ` +
                `(stop reason: ${repairStopReason}): ${error}`,
            );
            if (repairStopReason !== undefined) {
              logger.info("agent.repaired", eventFields);
            }

            const durationMs = Date.now() - startedAt;
            logger.info("agent.completed", {
              ...eventFields,
              durationMs,
              steps,
              salvaged,
              ...usage,
              findingCount: findings.length,
            });
            deps.onUsage?.(report(durationMs));
            agentObservation.update({
              output: { findingCount: findings.length },
              metadata: {
                steps,
                salvaged,
                ...usage,
              },
            });
            return findings;
          } catch (error) {
            const durationMs = Date.now() - startedAt;
            const fields = {
              ...eventFields,
              durationMs,
              steps,
              salvaged,
              ...usage,
              error: errorMessage(error),
              errorName: errorName(error),
            };
            if (isCancellation(error, context.signal)) {
              logger.info("agent.cancelled", fields);
            } else {
              logger.error("agent.failed", fields);
            }
            deps.onUsage?.(report(durationMs));
            agentObservation.update({
              level: "ERROR",
              statusMessage: errorMessage(error),
              metadata: {
                steps,
                salvaged,
                ...usage,
              },
            });
            throw error;
          }
        },
        { asType: "agent" },
      );
    },
  };
}
