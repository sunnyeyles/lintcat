import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pr-review/design";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  CategorySeverityChart,
  parseRange,
  RANGE_PHRASE,
  RangeScope,
  ReviewVolumeChart,
  SeverityTrendChart,
} from "@/components/charts";
import { PageHeader } from "@/components/shell";
import { ChartCardSkeleton, StatGridSkeleton } from "@/components/ui";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatDuration, formatNumber } from "@/lib/format";
import type { Range } from "@pr-review/db/dashboard";

export const metadata: Metadata = { title: "Trends" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function TrendsSkeleton() {
  return (
    <>
      <StatGridSkeleton count={4} />
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <ChartCardSkeleton height={200} />
      </div>
    </>
  );
}

async function TrendsBody({ slug, range }: { slug: string; range: Range }) {
  const trends = await (await data(slug)).getTrends(range);
  const phrase = RANGE_PHRASE[range];
  const { totals } = trends;
  const highShare =
    totals.findings > 0 ? Math.round((totals.bySeverity.high / totals.findings) * 100) : 0;

  return (
    <>
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
          hint="per review"
        />
      </StatGrid>

      {totals.reviews === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing to plot yet</EmptyTitle>
            <EmptyDescription>{`No reviews landed in ${phrase}. Try a wider range.`}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="min-w-0 xl:col-span-2">
            <SeverityTrendChart points={trends.points} rangePhrase={phrase} />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <ReviewVolumeChart points={trends.points} rangePhrase={phrase} />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <CategorySeverityChart
              byCategory={trends.byCategory}
              rangePhrase={phrase}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const range = parseRange((await searchParams).range);
  const phrase = RANGE_PHRASE[range];

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Trends"
        description={`What the review found in ${phrase}, and where it came from.`}
      />

      <div className="mt-8">
        <RangeScope range={range}>
          <Suspense fallback={<TrendsSkeleton />}>
            <TrendsBody slug={slug} range={range} />
          </Suspense>
        </RangeScope>
      </div>
    </>
  );
}
