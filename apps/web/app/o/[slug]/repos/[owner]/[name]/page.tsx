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
import { InlineSkeleton, StatGridSkeleton, TableCardSkeleton } from "@/components/ui";
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

async function PullRequestCount({ slug, repoId }: { slug: string; repoId: number }) {
  const groups = groupByPr(await repoReviews(slug, repoId));
  return `${formatNumber(groups.length)} pull requests`;
}

// Every stat reads the one 30-day trends query, so they resolve together.
async function RepoStats({
  slug,
  repo,
}: {
  slug: string;
  repo: { id: number; owner: string; name: string };
}) {
  const { totals, points } = await (await data(slug)).getTrends("30d", repo.id);
  return (
    <StatGrid>
      <Stat label="Reviews / 30d" value={formatNumber(totals.reviews)}>
        <Sparkline
          points={points}
          label={`Daily review volume for ${repo.owner}/${repo.name} over the last 30 days`}
        />
      </Stat>
      <Stat label="High severity / 30d" value={formatNumber(totals.bySeverity.high)} />
      <Stat label="Median duration / 30d" value={formatDuration(totals.medianDurationMs)} />
      <Stat label="Spend / 30d" value={formatUsd(totals.costUsd)} />
    </StatGrid>
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

      <div className="mt-8">
        <Suspense fallback={<StatGridSkeleton count={4} sparkline />}>
          <RepoStats slug={slug} repo={repo} />
        </Suspense>
      </div>

      <Section title="Review history">
        <Suspense fallback={<TableCardSkeleton rows={8} columns={HISTORY_COLUMNS.length} />}>
          <ReviewHistory slug={slug} repo={repo} />
        </Suspense>
      </Section>
    </>
  );
}
