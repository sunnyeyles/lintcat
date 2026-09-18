/**
 * The specialists this action ships. None run unless a repository names one in
 * its agent configuration.
 */
import type { AgentDefinition } from "#src/agents/definition";
import { CORRECTNESS_AGENT } from "#src/agents/specialists/correctness-agent";
import { DOCS_DRIFT_AGENT } from "#src/agents/specialists/docs-drift-agent";
import { PERFORMANCE_AGENT } from "#src/agents/specialists/performance-agent";
import { SECURITY_AGENT } from "#src/agents/specialists/security-agent";
import { TEST_COVERAGE_AGENT } from "#src/agents/specialists/test-coverage-agent";

/** Listing order is what an error message offers; it is not a run order. */
const BUILT_IN_AGENTS: readonly AgentDefinition[] = [
  SECURITY_AGENT,
  CORRECTNESS_AGENT,
  PERFORMANCE_AGENT,
  TEST_COVERAGE_AGENT,
  DOCS_DRIFT_AGENT,
];

/** The names configuration may use, for error messages and documentation. */
export const BUILT_IN_AGENT_NAMES: readonly string[] = BUILT_IN_AGENTS.map(
  (agent) => agent.category,
);

export function findBuiltInAgent(name: string): AgentDefinition | undefined {
  return BUILT_IN_AGENTS.find((agent) => agent.category === name);
}
