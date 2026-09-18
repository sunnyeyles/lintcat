import { Chip, ChipDot, type ChipProps, cn } from "@pr-review/design";

import type { AgentName } from "@/lib/data/types";

const AGENT_TONES: Record<AgentName, ChipProps["tone"]> = {
  security: "agent-security",
  correctness: "agent-correctness",
  performance: "agent-performance",
  "test-coverage": "agent-tests",
  "docs-drift": "agent-docs",
};

export const AGENT_LABELS: Record<AgentName, string> = {
  security: "security",
  correctness: "correctness",
  performance: "performance",
  "test-coverage": "test-coverage",
  "docs-drift": "docs-drift",
};

export type AgentChipProps = {
  agent: AgentName;
  label?: string;
  className?: string;
};

export function AgentChip({ agent, label, className }: AgentChipProps) {
  return (
    <Chip tone={AGENT_TONES[agent]} className={cn("font-normal", className)}>
      <ChipDot />
      {label ?? AGENT_LABELS[agent]}
    </Chip>
  );
}
