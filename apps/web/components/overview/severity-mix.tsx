import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

import { SEVERITIES } from "@/components/review/sort";
import { SeverityBadge } from "@/components/ui";
import type { Severity } from "@pr-review/schemas";

export type SeverityMixProps = {
  bySeverity: Record<Severity, number>;
  className?: string;
  empty?: ReactNode;
};

const NO_FINDINGS = <span className="font-mono text-xs text-muted-foreground">no findings</span>;

export function SeverityMix({ bySeverity, className, empty = NO_FINDINGS }: SeverityMixProps) {
  const present = SEVERITIES.filter((severity) => bySeverity[severity] > 0);

  if (present.length === 0) return empty;

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {present.map((severity) => (
        <SeverityBadge key={severity} severity={severity} count={bySeverity[severity]} />
      ))}
    </span>
  );
}
