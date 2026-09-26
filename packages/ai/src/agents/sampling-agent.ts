/** A review agent over one text completion: no tools, no loop, no second turn. */
import type { RepositoryIndex } from "@pr-review/index";

import type { ReviewAgent, ReviewContext } from "#src/agent-contract";
import {
  renderOutputContract,
  renderSecurityRules,
  type AgentDefinition,
} from "#src/agents/definition";
import { GENERAL_AGENT } from "#src/agents/general-agent";
import { acceptAgentOutput, extractAgentOutput } from "#src/agents/output";
import {
  buildOpeningMessage,
  type OpeningMessageLimits,
} from "#src/agents/opening-message";

/** The whole review fits in one request, so the diff is cut harder than the tool loop cuts it. */
const OPENING_LIMITS: OpeningMessageLimits = {
  maxListedFiles: 200,
  maxDescriptionChars: 4_000,
  descriptionMarker: "\n[... description truncated]",
  diff: { maxChars: 48_000, maxFileChars: 12_000 },
};

const DEFAULT_MAX_TOKENS = 8_000;

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
  /** Whose role, focus and finding category the one prompt carries. */
  agent?: AgentDefinition | undefined;
  index?: RepositoryIndex | undefined;
  maxTokens?: number | undefined;
}

/** Everything the tool-loop prompt promises tools for, said as an absence instead. */
function buildSystemPrompt(agent: AgentDefinition): string {
  return `You are the ${agent.role} in an automated pull-request review system.

# Role
${agent.focus}

# Context
The one message below is everything you get: the PR title and description, the changed-file list, what the repository index knows about those files, and the diff. You have no tools, no way to read a file this diff does not show, and no second turn. Report only what the material below makes concrete, and say nothing about code you cannot see.
Never propose a "patch". Its "expected" text has to match the file byte for byte and you cannot read the file, so a patch here is discarded. Put the fix in "suggestedFix" instead.

${renderSecurityRules(agent.category)}

${renderOutputContract(agent.category)}`;
}

/** Builds the single-shot agent: one sampling request in, candidate findings out. */
export function createSamplingAgent(deps: SamplingAgentDeps): ReviewAgent {
  const agent = deps.agent ?? GENERAL_AGENT;
  const systemPrompt = buildSystemPrompt(agent);
  const maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: agent.category,

    async run(context: ReviewContext): Promise<readonly unknown[]> {
      const text = await deps.sample({
        systemPrompt,
        prompt: buildOpeningMessage(context, OPENING_LIMITS, { index: deps.index }),
        maxTokens,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      return acceptAgentOutput(
        agent.category,
        extractAgentOutput(text),
        (error) => `${agent.category} sampling agent produced invalid findings output: ${error}`,
      );
    },
  };
}
