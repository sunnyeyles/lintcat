import { Badge, cn } from "@pr-review/design";
import type { RiskBand } from "@pr-review/schemas";
import { Radius } from "lucide-react";

import { LEVEL_TONE } from "./level-tone";

export type RiskBadgeProps = {
  band: RiskBand;
  score: number;
  className?: string;
};

// Typed by RiskBand, so a band added to it fails here until it has a tone.
const RISK_TONE: Record<RiskBand, string> = LEVEL_TONE;

export function RiskBadge({ band, score, className }: RiskBadgeProps) {
  return (
    <Badge variant="outline" className={cn(RISK_TONE[band], className)}>
      <Radius aria-hidden />
      {band}
      <span className="tabular-nums opacity-80">{score}</span>
    </Badge>
  );
}
