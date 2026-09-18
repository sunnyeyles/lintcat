"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { formatUsd } from "@/lib/format";
import type { UsagePoint } from "@/lib/data/types";

import { axisLineProps, cursorProps, gridProps, tickProps } from "./axis";
import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { ChartTooltip } from "./chart-tooltip";
import { formatAxisDate } from "./series";
import { useChartColors } from "./use-chart-colors";

export function SpendTrendChart({
  points,
  rangePhrase,
}: {
  points: UsagePoint[];
  rangePhrase: string;
}) {
  const colors = useChartColors();

  const total = points.reduce((sum, point) => sum + point.costUsd, 0);
  const peak = points.reduce(
    (best, point) => (point.costUsd > best.costUsd ? point : best),
    points[0],
  );

  const summary =
    !peak || total === 0
      ? `No spend recorded in ${rangePhrase}.`
      : `${formatUsd(total)} spent in ${rangePhrase}, averaging ${formatUsd(total / points.length)} a day. Dearest day ${formatAxisDate(peak.date)} at ${formatUsd(peak.costUsd)}.`;

  return (
    <ChartFrame
      title="Spend over time"
      description="Daily review cost."
      summary={summary}
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
          width={52}
          tick={tickProps(colors)}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatUsd}
        />
        <Tooltip
          cursor={cursorProps(colors)}
          content={<ChartTooltip formatValue={formatUsd} formatHeading={formatAxisDate} />}
        />
        <Area
          type="monotone"
          dataKey="costUsd"
          name="Cost"
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
