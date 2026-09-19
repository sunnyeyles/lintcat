"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/format";
import type { CategoryCount, Severity } from "@pr-review/db/dashboard";

import { axisLineProps, barCursorProps, gridProps, tickProps } from "./axis";
import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { ChartTooltip } from "./chart-tooltip";
import { SEVERITY_SERIES } from "./series";
import { useChartColors } from "./use-chart-colors";

const TOP_N = 7;

type CategoryRow = { category: string; count: number } & Record<Severity, number>;

function fold(byCategory: CategoryCount[]): CategoryRow[] {
  const sorted = [...byCategory].sort((a, b) => b.count - a.count);
  const head = sorted.slice(0, TOP_N).map((entry) => ({
    category: entry.category,
    count: entry.count,
    ...entry.bySeverity,
  }));
  const tail = sorted.slice(TOP_N);
  if (tail.length === 0) return head;
  const other: CategoryRow = { category: `Other (${tail.length})`, count: 0, low: 0, medium: 0, high: 0 };
  for (const entry of tail) {
    other.count += entry.count;
    other.low += entry.bySeverity.low;
    other.medium += entry.bySeverity.medium;
    other.high += entry.bySeverity.high;
  }
  return [...head, other];
}

export function CategorySeverityChart({
  byCategory,
  rangePhrase,
}: {
  byCategory: CategoryCount[];
  rangePhrase: string;
}) {
  const colors = useChartColors();
  const rows = fold(byCategory);
  const top = rows[0];

  const summary =
    !top
      ? `No categorised findings in ${rangePhrase}.`
      : `${top.category} leads in ${rangePhrase} with ${formatNumber(top.count)} findings (${formatNumber(top.high)} high). Bars are named on the axis and split by severity.`;

  return (
    <ChartFrame
      title="Top categories"
      description={`Most-reported categories, split by severity. Top ${TOP_N} shown.`}
      summary={summary}
      height={Math.max(200, rows.length * 40 + 32)}
      legend={SEVERITY_SERIES.map((series) => ({
        label: series.label,
        color: colors[series.color],
      }))}
      table={
        <ChartDataTable
          caption="Category breakdown"
          columns={["Category", "Low", "Medium", "High", "Total"]}
          rows={rows.map((row) => ({
            key: row.category,
            cells: [
              row.category,
              formatNumber(row.low),
              formatNumber(row.medium),
              formatNumber(row.high),
              formatNumber(row.count),
            ],
          }))}
        />
      }
    >
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid {...gridProps(colors)} vertical horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={tickProps(colors)}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatNumber}
        />
        <YAxis
          type="category"
          dataKey="category"
          width={116}
          tick={tickProps(colors)}
          tickLine={false}
          axisLine={axisLineProps(colors)}
        />
        <Tooltip
          cursor={barCursorProps(colors)}
          content={<ChartTooltip formatValue={formatNumber} totalLabel="Total" />}
        />
        {SEVERITY_SERIES.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            stackId="severity"
            fill={colors[series.color]}
            stroke={colors.surface}
            strokeWidth={2}
            maxBarSize={22}
            radius={index === SEVERITY_SERIES.length - 1 ? [0, 4, 4, 0] : undefined}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
