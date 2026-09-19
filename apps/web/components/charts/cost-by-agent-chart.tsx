"use client";

import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";

import { formatTokens, formatUsd } from "@/lib/format";
import type { AgentBreakdown } from "@pr-review/db/dashboard";

import { axisLineProps, barCursorProps, TICK_FONT_SIZE, tickProps } from "./axis";
import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { ChartTooltip } from "./chart-tooltip";
import { AGENT_COLOR, sumTokens } from "./series";
import { useChartColors } from "./use-chart-colors";

export function CostByAgentChart({
  byAgent,
  rangePhrase,
}: {
  byAgent: AgentBreakdown[];
  rangePhrase: string;
}) {
  const colors = useChartColors();
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
          tick={tickProps(colors)}
          tickLine={false}
          axisLine={axisLineProps(colors)}
        />
        <Tooltip
          cursor={barCursorProps(colors)}
          content={<ChartTooltip formatValue={formatUsd} />}
        />
        <Bar
          dataKey="costUsd"
          name="Cost"
          maxBarSize={20}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          {rows.map((row) => (
            <Cell key={row.agent} fill={colors[AGENT_COLOR[row.agent]]} />
          ))}
          <LabelList
            dataKey="costUsd"
            position="right"
            fill={colors.slate}
            fontSize={TICK_FONT_SIZE}
            formatter={formatUsd}
          />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
