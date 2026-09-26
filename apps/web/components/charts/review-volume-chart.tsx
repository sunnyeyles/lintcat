"use client";

import type { ChartConfig } from "@pr-review/design/chart";
import { AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/format";
import type { TrendPoint } from "@pr-review/db/dashboard";

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
  reviews: { label: "Reviews", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ReviewVolumeChart({
  points,
  rangePhrase,
}: {
  points: TrendPoint[];
  rangePhrase: string;
}) {
  const total = points.reduce((sum, point) => sum + point.reviews, 0);
  const busiest = peakOf(points, (point) => point.reviews);
  const perDay = points.length > 0 ? total / points.length : 0;

  const summary =
    !busiest || total === 0
      ? `No reviews in ${rangePhrase}.`
      : `${formatNumber(total)} reviews in ${rangePhrase}, averaging ${formatNumber(Math.round(perDay * 10) / 10)} a day. Peak ${formatNumber(busiest.reviews)} on ${formatAxisDate(busiest.date)}.`;

  return (
    <ChartFrame
      title="Review volume"
      description="Reviews completed per day."
      summary={summary}
      config={CONFIG}
      table={
        <ChartDataTable
          caption="Reviews by day"
          columns={["Day", "Reviews"]}
          rows={points.map((point) => ({
            key: point.date,
            cells: [formatAxisDate(point.date), formatNumber(point.reviews)],
          }))}
        />
      }
    >
      <AreaChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis {...DATE_AXIS} />
        <YAxis {...valueAxis(38)} allowDecimals={false} />
        <DailyTooltip />
        {trendArea("reviews", "Reviews")}
      </AreaChart>
    </ChartFrame>
  );
}
