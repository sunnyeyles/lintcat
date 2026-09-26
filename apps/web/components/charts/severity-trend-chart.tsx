"use client";

import { ChartLegend, ChartLegendContent } from "@pr-review/design/chart";
import { AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/format";
import type { TrendPoint } from "@pr-review/db/dashboard";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { CHART_MARGIN, DailyTooltip, DATE_AXIS, stackedAreas, valueAxis } from "./parts";
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
      <AreaChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis {...DATE_AXIS} />
        <YAxis {...valueAxis(38)} allowDecimals={false} />
        <DailyTooltip />
        <ChartLegend content={<ChartLegendContent />} />
        {stackedAreas(SEVERITY_SERIES, "severity")}
      </AreaChart>
    </ChartFrame>
  );
}
