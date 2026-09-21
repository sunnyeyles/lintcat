"use client";

import {
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@pr-review/design/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/format";
import type { TrendPoint } from "@pr-review/db/dashboard";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { formatAxisDate, SEVERITY_CONFIG, SEVERITY_SERIES } from "./series";

export function SeverityTrendChart({
  points,
  rangePhrase,
}: {
  points: TrendPoint[];
  rangePhrase: string;
}) {
  const totals = { low: 0, medium: 0, high: 0 };
  let peak = { date: "", count: 0 };
  for (const point of points) {
    totals.low += point.low;
    totals.medium += point.medium;
    totals.high += point.high;
    const day = point.low + point.medium + point.high;
    if (day > peak.count) peak = { date: point.date, count: day };
  }
  const total = totals.low + totals.medium + totals.high;

  const summary =
    total === 0
      ? `No findings in ${rangePhrase}.`
      : `${formatNumber(total)} findings in ${rangePhrase} — ${formatNumber(totals.high)} high, ${formatNumber(totals.medium)} medium, ${formatNumber(totals.low)} low. Busiest day ${formatAxisDate(peak.date)} with ${formatNumber(peak.count)}.`;

  return (
    <ChartFrame
      title="Findings over time"
      description="Daily findings, stacked by severity."
      summary={summary}
      config={SEVERITY_CONFIG}
      table={
        <ChartDataTable
          caption="Findings by day"
          columns={["Day", "Low", "Medium", "High"]}
          rows={points.map((point) => ({
            key: point.date,
            cells: [
              formatAxisDate(point.date),
              formatNumber(point.low),
              formatNumber(point.medium),
              formatNumber(point.high),
            ],
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
          content={
            <ChartTooltipContent labelFormatter={(l) => formatAxisDate(String(l))} />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {SEVERITY_SERIES.map((series) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stackId="severity"
            fill={`var(--color-${series.key})`}
            fillOpacity={0.9}
            stroke="var(--color-card)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}
