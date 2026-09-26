import type { ReactNode } from "react";

import { Stat } from "@/components/ui/stat";
import { formatDuration, formatNumber, formatPercent, share } from "@/lib/format";
import type { Trends } from "@pr-review/db/dashboard";

export type TrendStatCardsProps = {
  totals: Trends["totals"];
  /** The range as the labels print it, such as "30d". */
  range: string;
  /** Drawn under the reviews stat. */
  sparkline?: ReactNode;
};

export function TrendStatCards({ totals, range, sparkline }: TrendStatCardsProps) {
  const { high, medium, low } = totals.bySeverity;
  return (
    <>
      <Stat
        label={`Reviews / ${range}`}
        value={formatNumber(totals.reviews)}
        hint="one per head SHA"
      >
        {sparkline}
      </Stat>
      <Stat
        label={`Findings / ${range}`}
        value={formatNumber(totals.findings)}
        hint={`${formatNumber(medium)} medium · ${formatNumber(low)} low`}
      />
      <Stat
        label="High severity"
        value={formatNumber(high)}
        delta={{
          value: `${formatPercent(share(high, totals.findings))} of findings`,
          tone: high > 0 ? "stop" : "ok",
        }}
      />
      <Stat
        label="Median duration"
        value={formatDuration(totals.medianDurationMs)}
        hint="per review"
      />
    </>
  );
}
