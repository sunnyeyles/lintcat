import type { Metadata } from "next";

import {
  AgentFindingsChart,
  CategorySeverityChart,
  parseRange,
  RANGE_PHRASE,
  RangeScope,
  ReviewVolumeChart,
  SeverityTrendChart,
} from "@/components/charts";
import { PageHeader } from "@/components/shell";
import { EmptyState, Stat, StatGrid } from "@/components/ui";
import { data } from "@/lib/data";
import { formatDuration, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Trends" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const range = parseRange((await searchParams).range);
  const trends = await data().getTrends(range);
  const phrase = RANGE_PHRASE[range];
  const { totals } = trends;
  const highShare =
    totals.findings > 0 ? Math.round((totals.bySeverity.high / totals.findings) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="ANALYTICS"
        title="Trends"
        description={`What the agents found in ${phrase}, and where it came from.`}
      />

      <div className="mt-8">
        <RangeScope range={range}>
          <StatGrid>
            <Stat
              label={`Reviews / ${range}`}
              value={formatNumber(totals.reviews)}
              hint="one per head SHA"
            />
            <Stat
              label={`Findings / ${range}`}
              value={formatNumber(totals.findings)}
              hint={`${formatNumber(totals.bySeverity.medium)} medium · ${formatNumber(totals.bySeverity.low)} low`}
            />
            <Stat
              label="High severity"
              value={formatNumber(totals.bySeverity.high)}
              delta={{
                value: `${highShare}% of findings`,
                tone: totals.bySeverity.high > 0 ? "stop" : "ok",
              }}
            />
            <Stat
              label="Median duration"
              value={formatDuration(totals.medianDurationMs)}
              hint="slowest agent leg per review"
            />
          </StatGrid>

          {totals.reviews === 0 ? (
            <EmptyState
              title="Nothing to plot yet"
              description={`No reviews landed in ${phrase}. Try a wider range.`}
            />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
              <div className="min-w-0 xl:col-span-2">
                <SeverityTrendChart points={trends.points} rangePhrase={phrase} />
              </div>
              <div className="min-w-0">
                <ReviewVolumeChart points={trends.points} rangePhrase={phrase} />
              </div>
              <div className="min-w-0">
                <AgentFindingsChart byAgent={trends.byAgent} rangePhrase={phrase} />
              </div>
              <div className="min-w-0 xl:col-span-2">
                <CategorySeverityChart
                  byCategory={trends.byCategory}
                  rangePhrase={phrase}
                />
              </div>
            </div>
          )}
        </RangeScope>
      </div>
    </>
  );
}
