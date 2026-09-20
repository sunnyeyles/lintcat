import { Badge, cn } from "@pr-review/design";

import { AgentChip } from "@/components/ui";
import { AGENTS, type AgentName } from "@pr-review/db/dashboard";

const KNOWN = new Set<string>(AGENTS);

export type AgentChipsProps = {
  agents: readonly string[];
  max?: number;
  className?: string;
};

export function AgentChips({ agents, max = 3, className }: AgentChipsProps) {
  const named = agents.filter((agent): agent is AgentName => KNOWN.has(agent));
  const shown = named.slice(0, max);
  const hidden = named.slice(max);

  if (named.length === 0) {
    return <span className="text-muted-foreground font-mono text-xs">—</span>;
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((agent) => (
        <AgentChip key={agent} agent={agent} />
      ))}
      {hidden.length > 0 ? (
        <Badge variant="secondary" title={hidden.join(", ")}>
          +{hidden.length}
          <span className="sr-only"> more: {hidden.join(", ")}</span>
        </Badge>
      ) : null}
    </span>
  );
}
