import { Badge, cn } from "@pr-review/design";

import { AGENT_COLOR } from "@/components/charts/series";
import type { AgentName } from "@pr-review/db/dashboard";

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
    <Badge variant="outline" className={cn("font-normal", className)}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: AGENT_COLOR[agent] }}
      />
      {label ?? AGENT_LABELS[agent]}
    </Badge>
  );
}
