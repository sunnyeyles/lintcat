import { SeverityBadge } from "@/components/ui";
import type { Severity } from "@/lib/data";
import { cn } from "@/lib/utils";

const ORDER: readonly Severity[] = ["high", "medium", "low"];

export type SeverityMixProps = {
  bySeverity: Record<Severity, number>;
  className?: string;
};

export function SeverityMix({ bySeverity, className }: SeverityMixProps) {
  const present = ORDER.filter((severity) => bySeverity[severity] > 0);

  if (present.length === 0) {
    return <span className="font-mono text-[0.68rem] text-slate-dim">no findings</span>;
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {present.map((severity) => (
        <SeverityBadge key={severity} severity={severity} count={bySeverity[severity]} />
      ))}
    </span>
  );
}
