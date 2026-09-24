import { cn } from "@pr-review/design";

import { SEVERITIES } from "@/components/review/sort";
import { SeverityBadge } from "@/components/ui";
import type { Severity } from "@pr-review/db/dashboard";

export type SeverityMixProps = {
  bySeverity: Record<Severity, number>;
  className?: string;
};

export function SeverityMix({ bySeverity, className }: SeverityMixProps) {
  const present = SEVERITIES.filter((severity) => bySeverity[severity] > 0);

  if (present.length === 0) {
    return <span className="font-mono text-xs text-muted-foreground">no findings</span>;
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {present.map((severity) => (
        <SeverityBadge key={severity} severity={severity} count={bySeverity[severity]} />
      ))}
    </span>
  );
}
