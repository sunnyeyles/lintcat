"use client";

import {
  type ChartConfig,
  ChartTooltip,
  ChartTooltipContent,
} from "@pr-review/design";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/format";
import type { TrendPoint } from "@pr-review/db/dashboard";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
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
  const busiest = points.reduce(
    (best, point) => (point.reviews > best.reviews ? point : best),
    points[0] ?? { date: "", reviews: 0, low: 0, medium: 0, high: 0 },
  );
  const perDay = points.length > 0 ? total / points.length : 0;

  const summary =
    total === 0
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
      <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatAxisDate}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          interval="preserveStartEnd"
        />
        <YAxis
          width={38}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatNumber}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(l) => formatAxisDate(String(l))} />}
        />
        <Area
          type="monotone"
          dataKey="reviews"
          name="Reviews"
          stroke="var(--color-reviews)"
          strokeWidth={2}
          fill="var(--color-reviews)"
          fillOpacity={0.1}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartFrame>
  );
}
