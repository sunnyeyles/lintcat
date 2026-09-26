"use client";

import type { ChartConfig } from "@pr-review/design/chart";
import { AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatUsd } from "@/lib/format";
import type { UsagePoint } from "@pr-review/db/dashboard";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import {
  CHART_MARGIN,
  DailyTooltip,
  DATE_AXIS,
  peakOf,
  trendArea,
  valueAxis,
} from "./parts";
import { formatAxisDate } from "./series";

const CONFIG = {
  costUsd: { label: "Cost", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function SpendTrendChart({
  points,
  rangePhrase,
}: {
  points: UsagePoint[];
  rangePhrase: string;
}) {
  const total = points.reduce((sum, point) => sum + point.costUsd, 0);
  const peak = peakOf(points, (point) => point.costUsd);

  const summary =
    !peak || total === 0
      ? `No spend recorded in ${rangePhrase}.`
      : `${formatUsd(total)} spent in ${rangePhrase}, averaging ${formatUsd(total / points.length)} a day. Dearest day ${formatAxisDate(peak.date)} at ${formatUsd(peak.costUsd)}.`;

  return (
    <ChartFrame
      title="Spend over time"
      description="Daily review cost."
      summary={summary}
      config={CONFIG}
      table={
        <ChartDataTable
          caption="Spend by day"
          columns={["Day", "Cost"]}
          rows={points.map((point) => ({
            key: point.date,
            cells: [formatAxisDate(point.date), formatUsd(point.costUsd)],
          }))}
        />
      }
    >
      <AreaChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis {...DATE_AXIS} />
        <YAxis {...valueAxis(52, formatUsd)} />
        <DailyTooltip format={formatUsd} />
        {trendArea("costUsd", "Cost")}
      </AreaChart>
    </ChartFrame>
  );
}
