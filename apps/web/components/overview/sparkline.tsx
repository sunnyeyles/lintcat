import { cn } from "@pr-review/design";

import type { TrendPoint } from "@pr-review/db/dashboard";

export type SparklineProps = {
  points: TrendPoint[];
  label: string;
  className?: string;
};

const W = 120;
const H = 26;

export function Sparkline({ points, label, className }: SparklineProps) {
  const values = points.map((p) => p.reviews);
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const step = W / (values.length - 1);
  const y = (v: number) => H - 1 - (v / max) * (H - 2);
  const line = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const last = values[values.length - 1] ?? 0;

  return (
    <svg
      className={cn("h-[26px] w-full max-w-[120px]", className)}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline
        points={`0,${H} ${line} ${W},${H}`}
        fill="currentColor"
        stroke="none"
        className="text-primary/10"
      />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="text-primary"
      />
      <circle cx={W - 2} cy={y(last)} r="1.8" fill="currentColor" className="text-primary" />
    </svg>
  );
}
