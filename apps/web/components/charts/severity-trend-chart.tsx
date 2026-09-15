"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/format";
import type { TrendPoint } from "@/lib/data/types";

import { axisLineProps, cursorProps, gridProps, tickProps } from "./axis";
import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { ChartTooltip } from "./chart-tooltip";
import { formatAxisDate, SEVERITY_SERIES } from "./series";
import { useChartColors } from "./use-chart-colors";

export function SeverityTrendChart({
  points,
  rangePhrase,
}: {
  points: TrendPoint[];
  rangePhrase: string;
}) {
  const colors = useChartColors();

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
      legend={SEVERITY_SERIES.map((series) => ({
        label: series.label,
        color: colors[series.color],
      }))}
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
            <ChartTooltip
              formatValue={formatNumber}
              formatHeading={formatAxisDate}
              totalLabel="All severities"
            />
          }
        />
        {SEVERITY_SERIES.map((series) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stackId="severity"
            fill={colors[series.color]}
            fillOpacity={0.9}
            stroke={colors.surface}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}
