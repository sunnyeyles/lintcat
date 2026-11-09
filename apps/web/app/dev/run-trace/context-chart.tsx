"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@pr-review/design/chart";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  CONTEXT_LIMIT,
  contextSeries,
  formatDuration,
  formatTokens,
} from "@/app/dev/run-trace/trace-layout";
import type { AgentNode } from "@/lib/run-trace/types";

const CONFIG = {
  tokens: { label: "Context", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ContextChart({ agent }: { agent: AgentNode }) {
  const series = contextSeries(agent);
  if (series.length === 0) {
    return <p className="text-muted-foreground text-sm">No usage samples for this agent.</p>;
  }
  const peak = series.reduce((best, point) => (point.tokens > best.tokens ? point : best), series[0]);
  const top = Math.ceil((Math.max(CONTEXT_LIMIT, peak.tokens) * 1.1) / 50_000) * 50_000;
  const yTicks = Array.from({ length: top / 50_000 + 1 }, (_, i) => i * 50_000);
  const peakOnRight = peak.seconds > (series.at(-1)?.seconds ?? 0) / 2;
  const summary = `Peak ${formatTokens(peak.tokens)} tokens at +${formatDuration(peak.seconds * 1000)}, ${Math.round((peak.tokens / CONTEXT_LIMIT) * 100)}% of a 200k window, over ${series.length} model turns.`;

  return (
    <figure className="m-0 min-w-0">
      <div role="img" aria-label="Context window over time" className="h-44">
        <ChartContainer config={CONFIG} className="aspect-auto h-full w-full">
          <LineChart data={series} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="seconds"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(s: number) => formatDuration(s * 1000)}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={24}
            />
            <YAxis
              width={44}
              domain={[0, top]}
              ticks={yTicks}
              tickFormatter={formatTokens}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const seconds = Number(payload?.[0]?.payload?.seconds ?? 0);
                    return `+${formatDuration(seconds * 1000)}`;
                  }}
                  formatter={(value) => `${formatTokens(Number(value))} tokens`}
                />
              }
            />
            <ReferenceLine
              y={CONTEXT_LIMIT}
              stroke="var(--destructive)"
              strokeDasharray="4 4"
              label={{ value: "200k", position: "insideTopRight", fill: "var(--destructive)", fontSize: 11 }}
            />
            <Line
              type="stepAfter"
              dataKey="tokens"
              name="Context"
              stroke="var(--color-tokens)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <ReferenceDot
              x={peak.seconds}
              y={peak.tokens}
              r={4}
              fill="var(--color-tokens)"
              stroke="var(--background)"
              label={{ value: `peak ${formatTokens(peak.tokens)}`, position: "top", textAnchor: peakOnRight ? "end" : "start", fill: "var(--foreground)", fontSize: 11 }}
            />
          </LineChart>
        </ChartContainer>
      </div>
      <figcaption className="text-muted-foreground mt-2 text-xs">{summary}</figcaption>
    </figure>
  );
}
