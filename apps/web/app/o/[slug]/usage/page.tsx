import { costOf, type Range, type TokenCounts } from "@pr-review/db/dashboard";
import { EmptyState } from "@pr-review/design";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  CostByRepoTable,
  parseRange,
  RANGE_PHRASE,
  RangeScope,
  SpendTrendChart,
  sumTokens,
  type TokenKey,
  TokenCompositionChart,
} from "@/components/charts";
import { PageHeader } from "@/components/shell";
import { ChartCardSkeleton, StatGridSkeleton } from "@/components/ui";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatNumber, formatPercent, formatTokens, formatUsd, share } from "@/lib/format";
import type { SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Tokens & cost" };

const NO_TOKENS: TokenCounts = {
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
};

// Priced one class at a time, so the parts sum to the whole the chart splits.
function costPerClass(totals: TokenCounts): { byClass: Record<TokenKey, number>; total: number } {
  const byClass = {} as Record<TokenKey, number>;
  let total = 0;
  for (const key of Object.keys(NO_TOKENS) as TokenKey[]) {
    byClass[key] = costOf({ ...NO_TOKENS, [key]: totals[key] });
    total += byClass[key];
  }
  return { byClass, total };
}

function UsageSkeleton() {
  return (
    <>
      <StatGridSkeleton count={4} />
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <ChartCardSkeleton />
        <ChartCardSkeleton height={280} />
        <ChartCardSkeleton height={200} />
      </div>
    </>
  );
}

async function UsageBody({ slug, range }: { slug: string; range: Range }) {
  const usage = await (await data(slug)).getUsage(range);
  const phrase = RANGE_PHRASE[range];
  const { totals } = usage;

  const tokenTotal = sumTokens(totals);
  const cost = costPerClass(totals);

  return (
    <>
      <StatGrid>
        <Stat
          label={`Spend / ${range}`}
          value={formatUsd(totals.costUsd)}
          hint="illustrative, fixed price table"
        />
        <Stat
          label="Tokens"
          value={formatTokens(tokenTotal)}
          hint={`${formatTokens(totals.outputTokens)} of it output`}
        />
        <Stat
          label="Cache-read share"
          value={formatPercent(share(totals.cacheReadInputTokens, tokenTotal), 1)}
          delta={{
            value: `${formatPercent(share(cost.byClass.cacheReadInputTokens, cost.total), 1)} of spend`,
            tone: "ok",
          }}
          hint="cache reads bill at a tenth of input"
        />
        <Stat
          label={`Reviews / ${range}`}
          value={formatNumber(totals.reviewCount)}
          hint={
            totals.reviewCount > 0
              ? `${formatUsd(totals.costUsd / totals.reviewCount)} each`
              : "none billed"
          }
        />
      </StatGrid>

      {totals.reviewCount === 0 ? (
        <EmptyState
          title="No usage to report"
          description={`No reviews were billed in ${phrase}. Try a wider range.`}
        />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="min-w-0 xl:col-span-2">
            <SpendTrendChart points={usage.points} rangePhrase={phrase} />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <TokenCompositionChart
              points={usage.points}
              totals={totals}
              costByClass={cost.byClass}
              costTotal={cost.total}
              rangePhrase={phrase}
            />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <CostByRepoTable byRepo={usage.byRepo} rangePhrase={phrase} />
          </div>
        </div>
      )}
    </>
  );
}

export default async function UsagePage({
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
        eyebrow="Usage"
        title="Tokens & cost"
        description={`What reviews spent in ${phrase}. Cost uses the fixed price table in packages/db/src/dashboard/aggregate.ts, so the figures are illustrative rather than billed.`}
      />

      <div className="mt-8">
        <RangeScope range={range}>
          <Suspense fallback={<UsageSkeleton />}>
            <UsageBody slug={slug} range={range} />
          </Suspense>
        </RangeScope>
      </div>
    </>
  );
}
