"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { formatTokens, formatUsd } from "@/lib/format";
import type { TokenCounts, UsagePoint } from "@/lib/data/types";

import { axisLineProps, cursorProps, gridProps, tickProps } from "./axis";
import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { ChartTooltip } from "./chart-tooltip";
import { formatAxisDate, sumTokens, type TokenKey, TOKEN_SERIES } from "./series";
import { useChartColors } from "./use-chart-colors";

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

export function TokenCompositionChart({
  points,
  totals,
  costByClass,
  rangePhrase,
}: {
  points: UsagePoint[];
  totals: TokenCounts;
  costByClass: Record<TokenKey, number>;
  rangePhrase: string;
}) {
  const colors = useChartColors();

  const tokenTotal = sumTokens(totals);
  const costTotal = TOKEN_SERIES.reduce((sum, series) => sum + costByClass[series.key], 0);
  const cacheReadVolume = pct(totals.cacheReadInputTokens, tokenTotal);
  const cacheReadCost = pct(costByClass.cacheReadInputTokens, costTotal);

  const summary =
    tokenTotal === 0
      ? `No tokens recorded in ${rangePhrase}.`
      : `${formatTokens(tokenTotal)} tokens in ${rangePhrase}. Cache reads are ${Math.round(cacheReadVolume)}% of the volume but only ${Math.round(cacheReadCost)}% of the ${formatUsd(costTotal)} bill — they price at a tenth of input.`;

  return (
    <ChartFrame
      title="Token composition"
      description="Daily tokens by class, ordered cheapest to dearest."
      summary={summary}
      height={280}
      legend={TOKEN_SERIES.map((series) => ({
        label: series.label,
        color: colors[series.color],
      }))}
      footer={
        <div>
          <p className="mb-1.5 tracking-caps uppercase">Share of spend</p>
          <div className="flex h-2.5 w-full gap-[2px] rounded-xs">
            {TOKEN_SERIES.map((series) => (
              <span
                key={series.key}
                aria-hidden
                className="h-full min-w-0 grow-0 rounded-xs"
                style={{
                  flexBasis: `${pct(costByClass[series.key], costTotal)}%`,
                  backgroundColor: colors[series.color],
                }}
              />
            ))}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
            {TOKEN_SERIES.map((series) => (
              <li key={series.key}>
                {series.label} {Math.round(pct(costByClass[series.key], costTotal))}% of
                spend · {Math.round(pct(totals[series.key], tokenTotal))}% of volume
              </li>
            ))}
          </ul>
        </div>
      }
      table={
        <ChartDataTable
          caption="Tokens and cost by class"
          columns={["Class", "Tokens", "Share of volume", "Cost", "Share of spend"]}
          rows={TOKEN_SERIES.map((series) => ({
            key: series.key,
            cells: [
              series.label,
              formatTokens(totals[series.key]),
              `${Math.round(pct(totals[series.key], tokenTotal))}%`,
              formatUsd(costByClass[series.key]),
              `${Math.round(pct(costByClass[series.key], costTotal))}%`,
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
          width={46}
          tick={tickProps(colors)}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatTokens}
        />
        <Tooltip
          cursor={cursorProps(colors)}
          content={
            <ChartTooltip
              formatValue={formatTokens}
              formatHeading={formatAxisDate}
              totalLabel="All tokens"
              note="Cache reads bill at a tenth of input; output at five times it."
            />
          }
        />
        {TOKEN_SERIES.map((series) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stackId="tokens"
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
