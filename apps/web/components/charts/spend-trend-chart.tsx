"use client";

import {
  type ChartConfig,
  ChartTooltip,
  ChartTooltipContent,
} from "@pr-review/design/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatUsd } from "@/lib/format";
import type { UsagePoint } from "@pr-review/db/dashboard";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { formatAxisDate } from "./series";
import { formatWith } from "./tooltip-format";

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
          width={52}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatUsd}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(l) => formatAxisDate(String(l))}
              formatter={formatWith(formatUsd)}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="costUsd"
          name="Cost"
          stroke="var(--color-costUsd)"
          strokeWidth={2}
          fill="var(--color-costUsd)"
          fillOpacity={0.1}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartFrame>
  );
}
