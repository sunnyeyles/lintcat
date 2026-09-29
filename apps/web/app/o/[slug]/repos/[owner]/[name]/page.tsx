import { Button, Card } from "@pr-review/design";
import { Settings } from "@pr-review/design/icons";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import {
  EmptyNotice,
  groupByPr,
  ReviewsTable,
  Section,
  Sparkline,
  toReviewRow,
  type ReviewColumn,
} from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { InlineSkeleton, StatCardsSkeleton, TableCardSkeleton } from "@/components/ui";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatDuration, formatNumber, formatRelative, formatUsd } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

const HISTORY_COLUMNS: readonly ReviewColumn[] = [
  "pullRequest",
  "head",
  "risk",
  "findings",
  "duration",
  "ran",
];

// Shared by the header count and the history table, so both read one query.
const repoReviews = cache(
  async (slug: string, repoId: number) => (await data(slug)).listReviews({ repoId }),
);

const repoTrends = cache(
  async (slug: string, repoId: number) => (await data(slug)).getTrends("30d", repoId),
);

async function PullRequestCount({ slug, repoId }: { slug: string; repoId: number }) {
  const groups = groupByPr(await repoReviews(slug, repoId));
  return `${formatNumber(groups.length)} pull requests`;
}

async function ReviewsStat({
  slug,
  repo,
}: {
  slug: string;
  repo: { id: number; owner: string; name: string };
}) {
  const trends = await repoTrends(slug, repo.id);
  return (
    <Stat label="Reviews / 30d" value={formatNumber(trends.totals.reviews)}>
      <Sparkline
        points={trends.points}
        label={`Daily review volume for ${repo.owner}/${repo.name} over the last 30 days`}
      />
    </Stat>
  );
}

async function MedianDurationStat({ slug, repoId }: { slug: string; repoId: number }) {
  const trends = await repoTrends(slug, repoId);
  return (
    <Stat
      label="Median duration"
      value={formatDuration(trends.totals.medianDurationMs)}
      hint="last 30 days"
    />
  );
}

async function SpendStat({
  slug,
  repoId,
  allTimeCostUsd,
}: {
  slug: string;
  repoId: number;
  allTimeCostUsd: number;
}) {
  const usage = await (await data(slug)).getUsage("30d", repoId);
  return (
    <Stat
      label="Spend / 30d"
      value={formatUsd(usage.totals.costUsd)}
      hint={`${formatUsd(allTimeCostUsd)} all time`}
    />
  );
}

async function ReviewHistory({
  slug,
  repo,
}: {
  slug: string;
  repo: { id: number; owner: string; name: string };
}) {
  const reviews = await repoReviews(slug, repo.id);

  return (
    <Card className="py-0">
      {reviews.length > 0 ? (
        <ReviewsTable
          slug={slug}
          rows={reviews.map(toReviewRow)}
          columns={HISTORY_COLUMNS}
          caption={`Every review of ${repo.owner}/${repo.name}, grouped by pull request, newest first.`}
          groupByPullRequest
        />
      ) : (
        <EmptyNotice
          title="No reviews for this repository"
          sentence="No review has been published here yet."
          action={{
            label: "Check review settings",
            href: organizationPath(slug, `/repos/${repo.owner}/${repo.name}/settings`),
          }}
        />
      )}
    </Card>
  );
}

async function RevisitedNote({ slug, repoId }: { slug: string; repoId: number }) {
  const groups = groupByPr(await repoReviews(slug, repoId));
  if (!groups.some((group) => group.length > 1)) return null;
  return (
    <span className="text-muted-foreground font-mono text-xs">
      Grouped by pull request
    </span>
  );
}

async function ReviewsAllTimeStat({
  slug,
  repoId,
  reviewCount,
}: {
  slug: string;
  repoId: number;
  reviewCount: number;
}) {
  const groups = groupByPr(await repoReviews(slug, repoId));
  const revisited = groups.filter((group) => group.length > 1).length;
  return (
    <Stat
      label="Reviews all time"
      value={formatNumber(reviewCount)}
      hint={
        revisited > 0 ? `${formatNumber(revisited)} PRs reviewed more than once` : undefined
      }
    />
  );
}

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ slug: string; owner: string; name: string }>;
}) {
  const { slug, owner, name } = await params;
  const repo = await (await data(slug)).getRepo(owner, name);
  if (!repo) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Repository"
        title={
          <span className="font-mono text-[0.85em]">
            <span className="text-muted-foreground">{repo.owner}/</span>
            {repo.name}
          </span>
        }
        description={
          <>
            {`${formatNumber(repo.reviewCount)} reviews across `}
            <Suspense fallback={<InlineSkeleton className="h-4 w-28" />}>
              <PullRequestCount slug={slug} repoId={repo.id} />
            </Suspense>
            {` · last reviewed ${repo.lastReviewedAt ? formatRelative(repo.lastReviewedAt) : "never"}`}
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={organizationPath(slug, `/repos/${repo.owner}/${repo.name}/settings`)}>
              <Settings aria-hidden />
              Settings
            </Link>
          </Button>
        }
      />

      <StatGrid className="mt-8">
        <Suspense fallback={<StatCardsSkeleton count={1} hint={false} sparkline />}>
          <ReviewsStat slug={slug} repo={repo} />
        </Suspense>
        <Suspense fallback={<StatCardsSkeleton count={1} />}>
          <ReviewsAllTimeStat
            slug={slug}
            repoId={repo.id}
            reviewCount={repo.reviewCount}
          />
        </Suspense>
        <Stat label="Findings all time" value={formatNumber(repo.findingCount)} />
        <Stat label="High severity" value={formatNumber(repo.highSeverity)} />
        <Suspense fallback={<StatCardsSkeleton count={1} />}>
          <MedianDurationStat slug={slug} repoId={repo.id} />
        </Suspense>
        <Suspense fallback={<StatCardsSkeleton count={1} />}>
          <SpendStat slug={slug} repoId={repo.id} allTimeCostUsd={repo.costUsd} />
        </Suspense>
      </StatGrid>

      <Section
        title="Review history"
        action={
          <Suspense fallback={null}>
            <RevisitedNote slug={slug} repoId={repo.id} />
          </Suspense>
        }
      >
        <Suspense fallback={<TableCardSkeleton rows={8} />}>
          <ReviewHistory slug={slug} repo={repo} />
        </Suspense>
      </Section>
    </>
  );
}
