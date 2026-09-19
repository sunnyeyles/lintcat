import type { Finding } from "@pr-review/db";

import { AGENTS, isAgentName, type AgentName, type Severity } from "@/lib/data";

export const SEVERITIES: readonly Severity[] = ["high", "medium", "low"];

export const OTHER_AGENT = "other";

export type AgentFilterKey = AgentName | typeof OTHER_AGENT;

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function bySeverityThenConfidence(a: Finding, b: Finding): number {
  const rank = RANK[a.severity] - RANK[b.severity];
  return rank !== 0 ? rank : b.confidence - a.confidence;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(bySeverityThenConfidence);
}

export function agentKeyOf(finding: Finding): AgentFilterKey {
  const name = finding.agent ?? finding.category;
  return isAgentName(name) ? name : OTHER_AGENT;
}

export function agentKeysOf(findings: readonly Finding[]): AgentFilterKey[] {
  const present = new Set<AgentFilterKey>(findings.map(agentKeyOf));
  const known: AgentFilterKey[] = AGENTS.filter((a) => present.has(a));
  return present.has(OTHER_AGENT) ? [...known, OTHER_AGENT] : known;
}
