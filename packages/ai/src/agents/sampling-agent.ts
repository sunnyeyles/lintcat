/** A review agent over one text completion: no tools, no loop, no second turn. */
import type { RepositoryIndex } from "@pr-review/index";

import type { ReviewAgent, ReviewContext } from "#src/agent-contract";
import {
  buildSingleShotSystemPrompt,
  type AgentDefinition,
} from "#src/agents/definition";
import { buildOpeningPrompt, type OpeningBudget } from "#src/agents/opening-prompt";
import { extractAgentOutput } from "#src/agents/output";
import { AgentRunError, type AgentUsageReport } from "#src/agents/runtime";
import type { ReviewToolsClient } from "#src/agents/tools";
import { emptyTokenUsage, type TokenUsage } from "#src/usage";

/** The whole review fits in one request, so the diff is cut harder than the tool loop cuts it. */
const OPENING_BUDGET: OpeningBudget = {
  maxListedFiles: 200,
  diff: { maxChars: 48_000, maxFileChars: 12_000 },
  tools: false,
};

const DEFAULT_MAX_TOKENS = 8_000;

/** Sampling returns no token counts, so spend is estimated at this many characters a token. */
const CHARS_PER_TOKEN = 4;

/** One completion request, in the terms every client-side model shares. */
export interface SamplingRequest {
  systemPrompt: string;
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal | undefined;
}

/** Runs one completion on someone else's model and returns its text. */
export type SampleText = (request: SamplingRequest) => Promise<string>;

export interface SamplingAgentDeps {
  sample: SampleText;
  agent: AgentDefinition;
  github: Pick<ReviewToolsClient, "getFileContents">;
  index?: RepositoryIndex | undefined;
  maxTokens?: number | undefined;
  onUsage?: ((report: AgentUsageReport) => void) | undefined;
}

function estimateUsage(input: string, output: string): TokenUsage {
  return {
    ...emptyTokenUsage(),
    inputTokens: Math.ceil(input.length / CHARS_PER_TOKEN),
    outputTokens: Math.ceil(output.length / CHARS_PER_TOKEN),
  };
}

/** Builds the single-shot agent: one sampling request in, candidate findings out. */
export function createSamplingAgent(deps: SamplingAgentDeps): ReviewAgent {
  const { agent } = deps;
  const systemPrompt = buildSingleShotSystemPrompt(agent);
  const maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: agent.category,

    async run(context: ReviewContext): Promise<readonly unknown[]> {
      const startedAt = Date.now();
      const prompt = await buildOpeningPrompt(context, {
        github: deps.github,
        index: deps.index,
        budget: OPENING_BUDGET,
      });
      let text = "";
      let steps = 0;
      try {
        text = await deps.sample({
          systemPrompt,
          prompt,
          maxTokens,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        });
        steps = 1;
      } finally {
        deps.onUsage?.({
          agent: agent.category,
          durationMs: Date.now() - startedAt,
          steps,
          salvaged: false,
          usage:
            steps === 0 ? emptyTokenUsage() : estimateUsage(systemPrompt + prompt, text),
        });
      }
      const output = extractAgentOutput(text);
      if (!output.ok) {
        throw new AgentRunError(
          `${agent.category} sampling agent produced invalid findings output: ${output.error}`,
        );
      }
      return output.findings.filter(
        (finding) => finding.category === agent.category,
      );
    },
  };
}
