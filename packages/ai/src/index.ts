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
export {
  modelApiKeyEnvNames,
  modelConfigFromEnv,
  type ModelEnvNames,
} from "#src/model-env";
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
export {
  createReviewAgent,
  type AgentUsageReport,
  type ReviewAgentDeps,
} from "#src/agents/runtime";
export {
  createSamplingAgent,
  type SamplingAgentDeps,
  type SamplingRequest,
  type SampleText,
} from "#src/agents/sampling-agent";
export { GENERAL_AGENT } from "#src/agents/general-agent";
export {
  renderRepository,
  INDEX_ABSENT_LINE,
} from "#src/agents/repository-index";
export {
  withRepositoryHints,
  type AgentDefinition,
} from "#src/agents/definition";
