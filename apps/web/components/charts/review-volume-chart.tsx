"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/format";
import type { TrendPoint } from "@pr-review/db/dashboard";

import { axisLineProps, cursorProps, gridProps, tickProps } from "./axis";
import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { ChartTooltip } from "./chart-tooltip";
import { formatAxisDate } from "./series";
import { useChartColors } from "./use-chart-colors";

export function ReviewVolumeChart({
  points,
  rangePhrase,
}: {
  points: TrendPoint[];
  rangePhrase: string;
}) {
  const colors = useChartColors();

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
        <CartesianGrid {...gridProps(colors)} />
        <XAxis
          dataKey="date"
          tickFormatter={formatAxisDate}
          tick={tickProps(colors)}
          tickLine={false}
          axisLine={axisLineProps(colors)}
          minTickGap={28}
          interval="preserveStartEnd"
        />
        <YAxis
          width={38}
          allowDecimals={false}
          tick={tickProps(colors)}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatNumber}
        />
        <Tooltip
          cursor={cursorProps(colors)}
          content={
            <ChartTooltip formatValue={formatNumber} formatHeading={formatAxisDate} />
          }
        />
        <Area
          type="monotone"
          dataKey="reviews"
          name="Reviews"
          stroke={colors.accent}
          strokeWidth={2}
          fill={colors.accent}
          fillOpacity={0.1}
          activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartFrame>
  );
}
