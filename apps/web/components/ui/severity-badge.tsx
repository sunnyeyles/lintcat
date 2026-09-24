import { Badge, cn } from "@pr-review/design";

import type { Severity } from "@pr-review/db/dashboard";

export const SEVERITY_TONE: Record<Severity, string> = {
  low: "border-severity-low/40 bg-severity-low/10 text-severity-low",
  medium: "border-severity-medium/40 bg-severity-medium/10 text-severity-medium",
  high: "border-severity-high/40 bg-severity-high/15 text-severity-high",
};

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
