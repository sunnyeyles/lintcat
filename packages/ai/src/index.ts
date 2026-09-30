/**
 * The model side of the review system: provider selection, prompts, `agents/`.
 * Agents only propose findings; publishing lives in @pr-review/reviewer.
 */
export {
  createLanguageModel,
  defaultModelFor,
  modelChoicesFor,
  resolveModelId,
  resolveModelProvider,
  DEFAULT_MODEL_PROVIDER,
  MODEL_PROVIDERS,
  ModelProviderError,
  apiKeyEnvFor,
  type LanguageModelConfig,
  type ModelProvider,
  type ReviewModel,
} from "#src/model";
export type {
  ReviewAgent,
  ReviewContext,
} from "#src/agent-contract";
export {
  ReviewCancelledError,
  isCancellation,
} from "#src/cancellation";
export { addTokenUsage, emptyTokenUsage, type TokenUsage } from "#src/usage";
export type { AgentUsageReport } from "#src/agents/runtime";
export {
  samplingEngine,
  toolLoopEngine,
  type AgentRequest,
  type ReviewEngine,
} from "#src/agents/engine";
export type { SampleText } from "#src/agents/sampling-agent";
export { GENERAL_AGENT } from "#src/agents/general-agent";
export { renderConventionCounts } from "#src/agents/convention-counts";
export { renderRepository } from "#src/agents/repository-index";
export { renderConfigDrift } from "#src/agents/config-drift";
export { renderDocMentions } from "#src/agents/doc-mentions";
export {
  categorySlugs,
  type AgentDefinition,
} from "#src/agents/definition";
