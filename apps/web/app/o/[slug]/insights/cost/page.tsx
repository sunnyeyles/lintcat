import { costOf, type TokenCounts } from "@pr-review/db/dashboard";
import type { Metadata } from "next";

import {
  CostByRepoTable,
  parseRange,
  RANGE_PHRASE,
  SpendTrendChart,
  sumTokens,
  type TokenKey,
  TokenCompositionChart,
} from "@/components/charts";
import { RangeEmpty } from "@/components/insights";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatNumber, formatTokens, formatUsd } from "@/lib/format";
import { installAppUrl } from "@/lib/github-app";

export const metadata: Metadata = { title: "Tokens & cost" };

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

export default async function CostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const range = parseRange(query.range);
  const source = await data(slug);
  const usage = await source.getUsage(range);
  const phrase = RANGE_PHRASE[range];
  const { totals } = usage;
  const tokenTotal = sumTokens(totals);
  const cacheShare = tokenTotal > 0 ? (totals.cacheReadInputTokens / tokenTotal) * 100 : 0;

  return (
    <>
      <StatGrid>
        <Stat label={`Spend / ${range}`} value={formatUsd(totals.costUsd)} />
        <Stat label="Tokens" value={formatTokens(tokenTotal)} />
        <Stat label="Cache-read share" value={`${cacheShare.toFixed(1)}%`} />
        <Stat
          label="Cost per review"
          value={totals.reviewCount > 0 ? formatUsd(totals.costUsd / totals.reviewCount) : "—"}
        />
      </StatGrid>

      {totals.reviewCount === 0 ? (
        <RangeEmpty
          slug={slug}
          tab="cost"
          range={range}
          title="No usage to report"
          installHref={installAppUrl(source.organization.githubAccountId)}
        />
      ) : (
        <>
          <SpendTrendChart points={usage.points} rangePhrase={phrase} />
          <TokenCompositionChart
            points={usage.points}
            totals={totals}
            costByClass={costPerClass(totals)}
            rangePhrase={phrase}
          />
          <CostByRepoTable byRepo={usage.byRepo} rangePhrase={phrase} />
        </>
      )}
    </>
  );
}
