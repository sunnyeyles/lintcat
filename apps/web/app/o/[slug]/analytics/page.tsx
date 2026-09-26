import { EmptyState } from "@pr-review/design";
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
import { TrendStatCards } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { ChartCardSkeleton, StatGridSkeleton } from "@/components/ui";
import { StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import type { SearchParams } from "@/lib/search-params";
import type { Range } from "@pr-review/db/dashboard";

export const metadata: Metadata = { title: "Trends" };

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

  return (
    <>
      <StatGrid>
        <TrendStatCards totals={totals} range={range} />
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
