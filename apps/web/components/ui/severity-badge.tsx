import { Badge, cn } from "@pr-review/design";

import type { Severity } from "@pr-review/db/dashboard";

import { LEVEL_TONE } from "./level-tone";

// Typed by Severity, so a level added to it fails here until it has a tone.
const SEVERITY_TONE: Record<Severity, string> = LEVEL_TONE;

export type SeverityBadgeProps = {
  severity: Severity;
  count?: number;
  className?: string;
};

export function SeverityBadge({ severity, count, className }: SeverityBadgeProps) {
  return (
    <Badge variant="outline" className={cn(SEVERITY_TONE[severity], className)}>
      {severity}
      {count === undefined ? null : (
        <span className="tabular-nums opacity-80">{count}</span>
      )}
    </Badge>
  );
}
