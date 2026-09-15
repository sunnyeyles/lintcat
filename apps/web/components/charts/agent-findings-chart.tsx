"use client";

import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";

import { formatDuration, formatNumber } from "@/lib/format";
import type { AgentBreakdown } from "@/lib/data/types";

import { axisLineProps, barCursorProps, TICK_FONT_SIZE, tickProps } from "./axis";
import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { ChartTooltip } from "./chart-tooltip";
import { AGENT_COLOR } from "./series";
import { useChartColors } from "./use-chart-colors";

export function AgentFindingsChart({
  byAgent,
  rangePhrase,
}: {
  byAgent: AgentBreakdown[];
  rangePhrase: string;
}) {
  const colors = useChartColors();
  const rows = [...byAgent].sort((a, b) => b.findingCount - a.findingCount);
  const top = rows[0];
  const total = rows.reduce((sum, row) => sum + row.findingCount, 0);

  const summary =
    !top || total === 0
      ? `No agent findings in ${rangePhrase}.`
      : `${top.agent} raised the most in ${rangePhrase} — ${formatNumber(top.findingCount)} of ${formatNumber(total)} findings. Each bar is labelled with its count and named on the axis.`;

  return (
    <ChartFrame
      title="Findings by agent"
      description="Which reviewer is finding the work."
      summary={summary}
      height={Math.max(180, rows.length * 42)}
      table={
        <ChartDataTable
          caption="Agent breakdown"
          columns={["Agent", "Findings", "Reviews", "Median run"]}
          rows={rows.map((row) => ({
            key: row.agent,
            cells: [
              row.agent,
              formatNumber(row.findingCount),
              formatNumber(row.reviewCount),
              formatDuration(row.medianDurationMs),
            ],
          }))}
        />
      }
    >
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 44, bottom: 0, left: 0 }}
      >
        <XAxis type="number" hide allowDecimals={false} />
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
          content={<ChartTooltip formatValue={formatNumber} />}
        />
        <Bar
          dataKey="findingCount"
          name="Findings"
          maxBarSize={20}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          {rows.map((row) => (
            <Cell key={row.agent} fill={colors[AGENT_COLOR[row.agent]]} />
          ))}
          <LabelList
            dataKey="findingCount"
            position="right"
            fill={colors.slate}
            fontSize={TICK_FONT_SIZE}
            formatter={formatNumber}
          />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
