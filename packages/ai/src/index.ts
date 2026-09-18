/**
 * The model side of the review system: provider selection, prompts, `agents/`.
 * Agents only propose findings; publishing lives in @pr-review/reviewer.
 */
export {
  createLanguageModel,
  defaultModelFor,
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
export { emptyTokenUsage, type TokenUsage } from "#src/usage";
export { createReviewAgent } from "#src/agents/runtime";
export {
  renderRepositoryHints,
  withRepositoryHints,
  type AgentDefinition,
} from "#src/agents/definition";
export {
  createReviewAgents,
  gateAgentsByPaths,
  resolveAgentDefinitions,
  type SkippedAgent,
} from "#src/agents/agent-set";
export {
  DEFAULT_AGENT_CONFIG_PATH,
  loadAgentDefinitions,
  type ReadOptionalFile,
} from "#src/agents/config";
export {
  SynthesisError,
  createSynthesiser,
  emptySynthesisHints,
  renderSynthesisHints,
  type Synthesiser,
  type SynthesisHints,
} from "#src/agents/synthesiser";
export {
  DEFAULT_LANGFUSE_BASE_URL,
  DEFAULT_PROMPT_LABEL,
  createLangfusePromptClient,
  inCodePrompts,
  loadManagedPrompts,
  type LangfusePromptClient,
  type LangfusePromptClientConfig,
  type ManagedPrompts,
} from "#src/prompts";
export {
  createLangfusePromptWriter,
  seedFailed,
  seedManagedPrompts,
  type LangfusePromptWriter,
} from "#src/seed-prompts";
