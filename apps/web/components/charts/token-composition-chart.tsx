"use client";

import { ChartLegend, ChartLegendContent } from "@pr-review/design/chart";
import { AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatPercent, formatTokens, formatUsd, share } from "@/lib/format";
import type { UsagePoint } from "@pr-review/db/dashboard";
import type { TokenUsage } from "@pr-review/schemas";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { CHART_MARGIN, DailyTooltip, DATE_AXIS, stackedAreas, valueAxis } from "./parts";
import { sumTokens, TOKEN_CONFIG, type TokenKey, TOKEN_SERIES } from "./series";

export function TokenCompositionChart({
  points,
  totals,
  costByClass,
  costTotal,
  rangePhrase,
}: {
  points: UsagePoint[];
  totals: TokenUsage;
  costByClass: Record<TokenKey, number>;
  costTotal: number;
  rangePhrase: string;
}) {
  const tokenTotal = sumTokens(totals);
  const volumeShare = (key: TokenKey) => formatPercent(share(totals[key], tokenTotal));
  const spendShare = (key: TokenKey) => formatPercent(share(costByClass[key], costTotal));

  const summary =
    tokenTotal === 0
      ? `No tokens recorded in ${rangePhrase}.`
      : `${formatTokens(tokenTotal)} tokens in ${rangePhrase}. Cache reads are ${volumeShare("cacheReadInputTokens")} of the volume but only ${spendShare("cacheReadInputTokens")} of the ${formatUsd(costTotal)} bill — they price at a tenth of input.`;

  return (
    <ChartFrame
      title="Token composition"
      description="Daily tokens by class, ordered cheapest to dearest."
      summary={summary}
      config={TOKEN_CONFIG}
      height={280}
      footer={
        <div>
          <p className="eyebrow mb-1.5">Share of spend</p>
          <div className="flex h-2.5 w-full gap-[2px]">
            {TOKEN_SERIES.map((series) => (
              <span
                key={series.key}
                aria-hidden
                className="h-full min-w-0 grow-0 rounded-sm"
                style={{
                  flexBasis: `${share(costByClass[series.key], costTotal)}%`,
                  backgroundColor: `var(--color-${series.key})`,
                }}
              />
            ))}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
            {TOKEN_SERIES.map((series) => (
              <li key={series.key}>
                {series.label} {spendShare(series.key)} of spend ·{" "}
                {volumeShare(series.key)} of volume
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
              volumeShare(series.key),
              formatUsd(costByClass[series.key]),
              spendShare(series.key),
            ],
          }))}
        />
      }
    >
      <AreaChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis {...DATE_AXIS} />
        <YAxis {...valueAxis(46, formatTokens)} />
        <DailyTooltip format={formatTokens} />
        <ChartLegend content={<ChartLegendContent />} />
        {stackedAreas(TOKEN_SERIES, "tokens")}
      </AreaChart>
    </ChartFrame>
  );
}
