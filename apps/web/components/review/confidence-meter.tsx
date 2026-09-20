import { cn } from "@pr-review/design";

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
  const tone = pct >= 85 ? "bg-primary" : "bg-muted-foreground";
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
          "block h-1.5 w-full min-w-10 overflow-hidden rounded-sm bg-muted ring-border ring-1 ring-inset",
          barClassName,
        )}
      >
        <span
          className={cn("block h-full rounded-sm", tone)}
          style={{ width: `${pct}%` }}
        />
      </span>
      {labelled ? (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {pct}%
        </span>
      ) : null}
    </span>
  );
}
