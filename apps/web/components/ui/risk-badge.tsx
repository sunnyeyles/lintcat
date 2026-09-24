import { Badge, cn } from "@pr-review/design";
import type { RiskBand } from "@pr-review/schemas";
import { Radius } from "lucide-react";

export type RiskBadgeProps = {
  band: RiskBand;
  score: number;
  className?: string;
};

// Severity's tokens, so a high band reads as loud as a high finding; the icon tells them apart.
const RISK_TONE: Record<RiskBand, string> = {
  low: "border-severity-low/40 bg-severity-low/10 text-severity-low",
  medium: "border-severity-medium/40 bg-severity-medium/10 text-severity-medium",
  high: "border-severity-high/40 bg-severity-high/15 text-severity-high",
};

export function RiskBadge({ band, score, className }: RiskBadgeProps) {
  return (
    <Badge variant="outline" className={cn(RISK_TONE[band], className)}>
      <Radius aria-hidden />
      {band}
      <span className="tabular-nums opacity-80">{score}</span>
    </Badge>
  );
}
