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
  throwIfCancelled,
} from "#src/cancellation";
export { addTokenUsage, emptyTokenUsage, type TokenUsage } from "#src/usage";
export type { AgentUsageReport } from "#src/agents/runtime";
export {
  samplingEngine,
  toolLoopEngine,
  type AgentRequest,
  type ReviewEngine,
} from "#src/agents/engine";
export type { SamplingRequest, SampleText } from "#src/agents/sampling-agent";
export { DRIFT_CATEGORIES, GENERAL_AGENT } from "#src/agents/general-agent";
export {
  renderRepository,
  INDEX_ABSENT_LINE,
} from "#src/agents/repository-index";
export { renderConfigDrift } from "#src/agents/config-drift";
export { renderDocMentions } from "#src/agents/doc-mentions";
export {
  categorySlugs,
  withRepositoryHints,
  type AgentDefinition,
  type CategoryDefinition,
} from "#src/agents/definition";
