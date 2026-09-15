import { cn } from "@/lib/utils";

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export type ConfidenceMeterProps = {
  value: number;
  className?: string;
  barClassName?: string;
  labelled?: boolean;
};

export function ConfidenceMeter({
  value,
  className,
  barClassName,
  labelled = true,
}: ConfidenceMeterProps) {
  const pct = Math.round(clamp01(value) * 100);
  const tone = pct >= 85 ? "bg-ok" : pct >= 70 ? "bg-accent" : "bg-slate-dim";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        role="meter"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}% confidence`}
        className={cn(
          "block h-1.5 w-full min-w-10 overflow-hidden rounded-[1px] bg-surface-2 ring-1 ring-rule-soft ring-inset",
          barClassName,
        )}
      >
        <span
          className={cn("block h-full rounded-[1px]", tone)}
          style={{ width: `${pct}%` }}
        />
      </span>
      {labelled ? (
        <span className="shrink-0 font-mono text-[0.68rem] tabular-nums text-slate">
          {pct}%
        </span>
      ) : null}
    </span>
  );
}
