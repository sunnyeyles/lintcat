"use client";

import { ChartTooltip, ChartTooltipContent } from "@pr-review/design/chart";
import type { ReactNode } from "react";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";

import { formatDuration, formatNumber } from "@/lib/format";
import type { AgentBreakdown } from "@pr-review/db/dashboard";

import { ChartDataTable } from "./chart-data-table";
import { ChartFrame } from "./chart-frame";
import { AGENT_COLOR, AGENT_CONFIG } from "./series";

export function AgentFindingsChart({
  byAgent,
  rangePhrase,
}: {
  byAgent: AgentBreakdown[];
  rangePhrase: string;
}) {
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
      config={AGENT_CONFIG}
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
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar
          dataKey="findingCount"
          name="Findings"
          maxBarSize={20}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          {rows.map((row) => (
            <Cell key={row.agent} fill={AGENT_COLOR[row.agent]} />
          ))}
          <LabelList
            dataKey="findingCount"
            position="right"
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(value: ReactNode) => formatNumber(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
