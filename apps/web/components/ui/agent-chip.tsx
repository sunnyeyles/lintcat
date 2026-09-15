import type { AgentName } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const AGENT_STYLES: Record<AgentName, string> = {
  security: "border-agent-security/40 bg-agent-security/10 text-agent-security",
  correctness:
    "border-agent-correctness/40 bg-agent-correctness/10 text-agent-correctness",
  performance:
    "border-agent-performance/40 bg-agent-performance/10 text-agent-performance",
  "test-coverage": "border-agent-tests/40 bg-agent-tests/10 text-agent-tests",
  "docs-drift": "border-agent-docs/40 bg-agent-docs/10 text-agent-docs",
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
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-[0.2rem] font-mono text-[0.66rem] leading-none whitespace-nowrap",
        AGENT_STYLES[agent],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {label ?? AGENT_LABELS[agent]}
    </span>
  );
}
