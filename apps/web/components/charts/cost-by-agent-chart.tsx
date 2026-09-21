"use client";

import { ChartTooltip, ChartTooltipContent } from "@pr-review/design/chart";
import type { ReactNode } from "react";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";

import { formatTokens, formatUsd } from "@/lib/format";
import type { AgentBreakdown } from "@pr-review/db/dashboard";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { AGENT_COLOR, AGENT_CONFIG, sumTokens } from "./series";
import { formatWith } from "./tooltip-format";

export function CostByAgentChart({
  byAgent,
  rangePhrase,
}: {
  byAgent: AgentBreakdown[];
  rangePhrase: string;
}) {
  const rows = [...byAgent].sort((a, b) => b.costUsd - a.costUsd);
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const top = rows[0];

  const summary =
    !top || total === 0
      ? `No agent spend in ${rangePhrase}.`
      : `${top.agent} is the dearest agent in ${rangePhrase} at ${formatUsd(top.costUsd)} of ${formatUsd(total)}. Every bar is named on the axis and labelled with its cost.`;

  return (
    <ChartFrame
      title="Cost by agent"
      description="Where the spend goes, per reviewer."
      summary={summary}
      config={AGENT_CONFIG}
      height={Math.max(180, rows.length * 42)}
      table={
        <ChartDataTable
          caption="Agent cost breakdown"
          columns={["Agent", "Cost", "Tokens", "Reviews"]}
          rows={rows.map((row) => ({
            key: row.agent,
            cells: [
              row.agent,
              formatUsd(row.costUsd),
              formatTokens(sumTokens(row)),
              row.reviewCount,
            ],
          }))}
        />
      }
    >
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 56, bottom: 0, left: 0 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="agent"
          width={92}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <ChartTooltip
          content={<ChartTooltipContent hideLabel formatter={formatWith(formatUsd)} />}
        />
        <Bar
          dataKey="costUsd"
          name="Cost"
          maxBarSize={20}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          {rows.map((row) => (
            <Cell key={row.agent} fill={AGENT_COLOR[row.agent]} />
          ))}
          <LabelList
            dataKey="costUsd"
            position="right"
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(value: ReactNode) => formatUsd(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
