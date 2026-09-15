import type { Severity } from "@/lib/data/types";
import { cn } from "@/lib/utils";

type SeverityStyle = { chip: string; marker: string };

const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
  low: {
    chip: "rounded-full border-rule bg-transparent font-normal text-sev-low",
    marker: "size-1 rounded-full bg-current",
  },
  medium: {
    chip: "rounded-[2px] border-sev-medium/50 bg-sev-medium/10 font-semibold text-sev-medium",
    marker: "size-1.5 rounded-[1px] bg-current",
  },
  high: {
    chip: "rounded-[2px] border-sev-high bg-sev-high font-bold text-paper",
    marker: "h-2.5 w-[3px] bg-current",
  },
};

export type SeverityBadgeProps = {
  severity: Severity;
  count?: number;
  className?: string;
};

export function SeverityBadge({ severity, count, className }: SeverityBadgeProps) {
  const style = SEVERITY_STYLES[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-1.5 py-[0.2rem] font-mono text-[0.64rem] leading-none tracking-[0.1em] whitespace-nowrap uppercase",
        style.chip,
        className,
      )}
    >
      <span aria-hidden className={cn("shrink-0", style.marker)} />
      {severity}
      {count === undefined ? null : (
        <span className="tabular-nums opacity-80">{count}</span>
      )}
    </span>
  );
}
