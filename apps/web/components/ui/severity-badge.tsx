import { Chip, type ChipProps, cn } from "@pr-review/design";

import type { Severity } from "@pr-review/db/dashboard";

type SeverityStyle = { variant: ChipProps["variant"]; shape?: ChipProps["shape"]; marker: string };

const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
  low: { variant: "outline", shape: "pill", marker: "size-1 rounded-full" },
  medium: { variant: "tint", marker: "size-1.5 rounded-xs" },
  high: { variant: "solid", marker: "h-2.5 w-[3px]" },
};

export type SeverityBadgeProps = {
  severity: Severity;
  count?: number;
  className?: string;
};

export function SeverityBadge({ severity, count, className }: SeverityBadgeProps) {
  const { variant, shape, marker } = SEVERITY_STYLES[severity];
  return (
    <Chip tone={severity} variant={variant} shape={shape} caps className={className}>
      <span aria-hidden className={cn("shrink-0 bg-current", marker)} />
      {severity}
      {count === undefined ? null : (
        <span className="tabular-nums opacity-80">{count}</span>
      )}
    </Chip>
  );
}
