/**
 * Which reviewers an evaluation run puts in front of the fixtures. The arm
 * is the one changed variable, so both halves run the identical suite.
 */
import { GENERAL_AGENT, type AgentDefinition } from "@pr-review/ai";
import { repositoryAgents } from "@pr-review/ai/agent-test-support";

/** Set to `general` for the control arm: the general agent in place of the specialists. */
export const AGENT_SET_ENV = "EVAL_AGENTS";

/** The value selecting the control arm; anything else runs the configured specialists. */
export const GENERAL_ARM = "general";

/**
 * The agent set under evaluation: this repository's configured specialists,
 * or the single general agent that reviews when a repository configures none.
 */
export function evalAgentSet(
  env: Record<string, string | undefined>,
): AgentDefinition[] {
  const arm = (env[AGENT_SET_ENV] ?? "").trim().toLowerCase();
  return arm === GENERAL_ARM ? [GENERAL_AGENT] : repositoryAgents();
}
