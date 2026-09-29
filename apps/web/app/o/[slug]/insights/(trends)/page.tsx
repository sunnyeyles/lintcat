import type { Metadata } from "next";

import {
  CategorySeverityChart,
  parseRange,
  RANGE_PHRASE,
  ReviewVolumeChart,
  SeverityTrendChart,
} from "@/components/charts";
import { RangeEmpty } from "@/components/insights";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatDuration, formatNumber } from "@/lib/format";
import { installAppUrl } from "@/lib/github-app";

export const metadata: Metadata = { title: "Trends" };

export default async function TrendsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const range = parseRange(query.range);
  const source = await data(slug);
  const trends = await source.getTrends(range);
  const phrase = RANGE_PHRASE[range];
  const { totals } = trends;
  const high = totals.bySeverity.high;

  return (
    <>
      <StatGrid>
        <Stat label={`Reviews / ${range}`} value={formatNumber(totals.reviews)} />
        <Stat label={`Findings / ${range}`} value={formatNumber(totals.findings)} />
        <Stat
          label="High severity"
          value={formatNumber(high)}
          delta={
            high > 0
              ? { value: `${Math.round((high / totals.findings) * 100)}% of findings`, tone: "stop" }
              : undefined
          }
        />
        <Stat label="Median duration" value={formatDuration(totals.medianDurationMs)} />
      </StatGrid>

      {totals.reviews === 0 ? (
        <RangeEmpty
          slug={slug}
          tab="trends"
          range={range}
          title="Nothing to plot"
          installHref={installAppUrl(source.organization.githubAccountId)}
        />
      ) : (
        <>
          <SeverityTrendChart points={trends.points} rangePhrase={phrase} />
          <ReviewVolumeChart points={trends.points} rangePhrase={phrase} />
          <CategorySeverityChart byCategory={trends.byCategory} rangePhrase={phrase} />
        </>
      )}
    </>
  );
}
