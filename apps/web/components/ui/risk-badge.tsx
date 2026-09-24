import { Badge, cn } from "@pr-review/design";
import type { RiskBand } from "@pr-review/schemas";
import { Radius } from "lucide-react";

import { SEVERITY_TONE } from "./severity-badge";

export type RiskBadgeProps = {
  band: RiskBand;
  score: number;
  className?: string;
};

// Severity's tones, so a high band reads as loud as a high finding; the icon tells them apart.
export function RiskBadge({ band, score, className }: RiskBadgeProps) {
  return (
    <Badge variant="outline" className={cn(SEVERITY_TONE[band], className)}>
      <Radius aria-hidden />
      {band}
      <span className="tabular-nums opacity-80">{score}</span>
    </Badge>
  );
}
