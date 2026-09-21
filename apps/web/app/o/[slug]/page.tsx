import {
  Button,
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pr-review/design";
import Link from "next/link";
import { Suspense } from "react";

import { RepoTable, ReviewsTable, Section, Sparkline } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { StatCardsSkeleton, TableCardSkeleton } from "@/components/ui";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatDuration, formatNumber, formatUsd } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

async function TrendStats({ slug }: { slug: string }) {
  const trends = await (await data(slug)).getTrends("30d");
  const { totals } = trends;
  const highShare =
    totals.findings > 0
      ? Math.round((totals.bySeverity.high / totals.findings) * 100)
      : 0;

  return (
    <>
      <Stat
        label="Reviews / 30d"
        value={formatNumber(totals.reviews)}
        hint="one per head SHA"
      >
        <Sparkline
          points={trends.points}
          label="Daily review volume over the last 30 days"
        />
      </Stat>
      <Stat
        label="Findings / 30d"
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
    </>
  );
}

async function SpendStat({ slug }: { slug: string }) {
  const usage = await (await data(slug)).getUsage("30d");
  return (
    <Stat
      label="Spend / 30d"
      value={formatUsd(usage.totals.costUsd)}
      hint={`${formatNumber(usage.totals.reviewCount)} billed reviews`}
    />
  );
}

async function RecentReviews({ slug }: { slug: string }) {
  const reviews = await (await data(slug)).listReviews({ limit: 8 });
  return (
    <Card className="py-0">
      {reviews.length > 0 ? (
        <ReviewsTable
          slug={slug}
          reviews={reviews}
          caption="The eight most recent reviews, newest first."
        />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No reviews yet</EmptyTitle>
            <EmptyDescription>
              Once the action runs on a pull request, the review lands here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Card>
  );
}

async function ReposGlance({ slug }: { slug: string }) {
  const repos = await (await data(slug)).listRepos();
  return (
    <Card className="py-0">
      {repos.length > 0 ? (
        <RepoTable
          slug={slug}
          repos={repos}
          limit={6}
          caption="Repositories connected to this organization, most recently reviewed first."
        />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No repositories connected</EmptyTitle>
            <EmptyDescription>
              Add the review workflow to a repository to see it here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Card>
  );
}

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const source = await data((await params).slug);
  const { slug } = source.organization;

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        description={`${source.organization.name} — every review the agents published in the last 30 days, newest first.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={organizationPath(slug, "/repos")}>All repositories</Link>
          </Button>
        }
      />

      <StatGrid className="mt-8">
        <Suspense fallback={<StatCardsSkeleton count={4} />}>
          <TrendStats slug={slug} />
        </Suspense>
        <Suspense fallback={<StatCardsSkeleton count={1} />}>
          <SpendStat slug={slug} />
        </Suspense>
      </StatGrid>

      <Section title="Recent reviews">
        <Suspense fallback={<TableCardSkeleton rows={8} />}>
          <RecentReviews slug={slug} />
        </Suspense>
      </Section>

      <Section
        title="Repositories at a glance"
        action={
          <Link
            href={organizationPath(slug, "/repos")}
            className="text-link font-mono text-xs no-underline hover:underline"
          >
            View all →
          </Link>
        }
      >
        <Suspense fallback={<TableCardSkeleton rows={6} />}>
          <ReposGlance slug={slug} />
        </Suspense>
      </Section>
    </>
  );
}
