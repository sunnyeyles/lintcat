import { EmptyState, Stat, StatGrid } from "@pr-review/design";
import type { Metadata } from "next";

import {
  CostByAgentChart,
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
import { costOf, data } from "@/lib/data";
import type { TokenCounts } from "@/lib/data/types";
import { formatNumber, formatTokens, formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "Tokens & cost" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NO_TOKENS: TokenCounts = {
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
};

function costPerClass(totals: TokenCounts): Record<TokenKey, number> {
  return {
    inputTokens: costOf({ ...NO_TOKENS, inputTokens: totals.inputTokens }),
    cacheCreationInputTokens: costOf({
      ...NO_TOKENS,
      cacheCreationInputTokens: totals.cacheCreationInputTokens,
    }),
    cacheReadInputTokens: costOf({
      ...NO_TOKENS,
      cacheReadInputTokens: totals.cacheReadInputTokens,
    }),
    outputTokens: costOf({ ...NO_TOKENS, outputTokens: totals.outputTokens }),
  };
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const range = parseRange((await searchParams).range);
  const usage = await data().getUsage(range);
  const phrase = RANGE_PHRASE[range];
  const { totals } = usage;

  const tokenTotal = sumTokens(totals);
  const cacheShare =
    tokenTotal > 0 ? (totals.cacheReadInputTokens / tokenTotal) * 100 : 0;
  const costByClass = costPerClass(totals);
  const cacheCostShare =
    totals.costUsd > 0 ? (costByClass.cacheReadInputTokens / totals.costUsd) * 100 : 0;

  return (
    <>
      <PageHeader
        eyebrow="Usage"
        title="Tokens & cost"
        description={`What the agents spent in ${phrase}. Cost uses the fixed price table in lib/data/mock.ts, so the figures are illustrative rather than billed.`}
      />

      <div className="mt-8">
        <RangeScope range={range}>
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
              value={`${cacheShare.toFixed(1)}%`}
              delta={{
                value: `${cacheCostShare.toFixed(1)}% of spend`,
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
                  costByClass={costByClass}
                  rangePhrase={phrase}
                />
              </div>
              <div className="min-w-0">
                <CostByAgentChart byAgent={usage.byAgent} rangePhrase={phrase} />
              </div>
              <div className="min-w-0">
                <CostByRepoTable byRepo={usage.byRepo} rangePhrase={phrase} />
              </div>
            </div>
          )}
        </RangeScope>
      </div>
    </>
  );
}
