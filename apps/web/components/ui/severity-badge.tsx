import { Badge } from "@pr-review/design";
import type { ComponentProps } from "react";

import type { Severity } from "@pr-review/db/dashboard";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

const SEVERITY_VARIANT: Record<Severity, BadgeVariant> = {
  low: "outline",
  medium: "secondary",
  high: "destructive",
};

export type SeverityBadgeProps = {
  severity: Severity;
  count?: number;
  className?: string;
};

export function SeverityBadge({ severity, count, className }: SeverityBadgeProps) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity]} className={className}>
      {severity}
      {count === undefined ? null : (
        <span className="tabular-nums opacity-80">{count}</span>
      )}
    </Badge>
  );
}
