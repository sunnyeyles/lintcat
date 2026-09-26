"use client";

import { ChartTooltip, ChartTooltipContent } from "@pr-review/design/chart";
import type { ComponentProps } from "react";
import { Area, type XAxis, type YAxis } from "recharts";

import { formatNumber } from "@/lib/format";

import { formatAxisDate, type SeriesDef } from "./series";

export const CHART_MARGIN = { top: 4, right: 8, bottom: 0, left: 0 };

export const DATE_AXIS = {
  dataKey: "date",
  tickFormatter: formatAxisDate,
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  minTickGap: 28,
  interval: "preserveStartEnd",
} satisfies ComponentProps<typeof XAxis>;

export function valueAxis(width: number, format = formatNumber): ComponentProps<typeof YAxis> {
  return { width, tickLine: false, axisLine: false, tickMargin: 8, tickFormatter: format };
}

export function DailyTooltip({ format = formatNumber }: { format?: (value: number) => string }) {
  return (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(label) => formatAxisDate(String(label))}
          valueFormatter={format}
        />
      }
    />
  );
}

// A function, not a component, so each Area stays a direct child of the chart.
export function trendArea(key: string, name: string) {
  return (
    <Area
      type="monotone"
      dataKey={key}
      name={name}
      stroke={`var(--color-${key})`}
      strokeWidth={2}
      fill={`var(--color-${key})`}
      fillOpacity={0.1}
      isAnimationActive={false}
    />
  );
}

export function stackedAreas<K extends string>(
  series: readonly SeriesDef<K>[],
  stackId: string,
) {
  return series.map((entry) => (
    <Area
      key={entry.key}
      type="monotone"
      dataKey={entry.key}
      name={entry.label}
      stackId={stackId}
      fill={`var(--color-${entry.key})`}
      fillOpacity={0.9}
      stroke="var(--color-card)"
      strokeWidth={2}
      isAnimationActive={false}
    />
  ));
}

export function peakOf<T>(points: readonly T[], value: (point: T) => number): T | undefined {
  let best: T | undefined;
  for (const point of points) {
    if (best === undefined || value(point) > value(best)) best = point;
  }
  return best;
}
