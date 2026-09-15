/**
 * Serialises a dashboard AgentConfig into the two YAML documents it maps
 * onto: the repository's agent file, and the workflow inputs beside it.
 */
import { AGENTS, type AgentConfig, type AgentName } from "./data/types";

export const AGENT_CONFIG_PATH = ".github/pr-review-agents.yml";

export const DEFAULT_CONFIG: AgentConfig = {
  agents: [...AGENTS],
  fix: false,
  memoryBranch: null,
  paths: { include: [], exclude: [] },
};

/** Wording from the README's agent table. */
const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  security: "Auth, cross-tenant access, injection, secret leakage, privilege",
  correctness: "Logic errors, wrong bounds, unhandled null, broken error handling",
  performance: "N+1 queries, unbounded reads, quadratic scans, blocking I/O",
  "test-coverage": "Branches this change adds or changes and leaves untested",
  "docs-drift": "Documentation this change made wrong",
};

export function describeAgent(agent: AgentName): string {
  return AGENT_DESCRIPTIONS[agent];
}

const PLAIN_SCALAR = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const YAML_KEYWORD = /^(true|false|null|yes|no|on|off|~)$/i;

/** Quotes only what YAML would otherwise read as an indicator or a non-string. */
export function yamlString(value: string): string {
  if (PLAIN_SCALAR.test(value) && !YAML_KEYWORD.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Include globs, then excludes as the `!` negations the action subtracts with. */
export function pathPatterns(paths: AgentConfig["paths"]): string[] {
  return [
    ...paths.include,
    ...paths.exclude.map((glob) => (glob.startsWith("!") ? glob : `!${glob}`)),
  ];
}

/**
 * The dashboard carries one path gate; the file spells it per agent, so the
 * same patterns are written under each.
 */
export function toYaml(config: AgentConfig): string {
  if (config.agents.length === 0) {
    return "# No agents selected. The action fails until this names at least one.\nagents: []\n";
  }

  const patterns = pathPatterns(config.paths);
  const lines = ["agents:"];
  for (const agent of config.agents) {
    if (patterns.length === 0) {
      lines.push(`  - ${yamlString(agent)}`);
      continue;
    }
    lines.push(`  - agent: ${yamlString(agent)}`, "    paths:");
    for (const pattern of patterns) lines.push(`      - ${yamlString(pattern)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * `fix` and `memory-branch` are action inputs, not keys of the agent file —
 * its schema is strict and would reject them.
 */
export function toWorkflowYaml(config: AgentConfig): string {
  const lines: string[] = [];
  if (config.fix) lines.push('    fix: "true"');
  if (config.memoryBranch !== null && config.memoryBranch !== "") {
    lines.push(`    memory-branch: ${yamlString(config.memoryBranch)}`);
  }
  if (lines.length === 0) return "";
  return `# In your workflow, under the action's \`with:\`\nwith:\n${lines.join("\n")}\n`;
}

/** Reorders one agent by `delta`, or returns the list unchanged at an end. */
export function moveAgent(
  agents: AgentName[],
  index: number,
  delta: number,
): AgentName[] {
  const target = index + delta;
  if (index < 0 || index >= agents.length || target < 0 || target >= agents.length) {
    return agents;
  }
  const next = [...agents];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return agents;
  next.splice(target, 0, moved);
  return next;
}

/** Keeps AGENTS order for agents being switched back on. */
export function toggleAgent(
  agents: AgentName[],
  agent: AgentName,
  enabled: boolean,
): AgentName[] {
  if (!enabled) return agents.filter((name) => name !== agent);
  if (agents.includes(agent)) return agents;
  return [...agents, agent].sort((a, b) => AGENTS.indexOf(a) - AGENTS.indexOf(b));
}
