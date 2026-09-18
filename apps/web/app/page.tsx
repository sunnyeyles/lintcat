import { Button, Card, EmptyState, Stat, StatGrid } from "@pr-review/design";
import Link from "next/link";

import {
  RepoTable,
  ReviewsTable,
  Section,
  Sparkline,
} from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { data } from "@/lib/data";
import { formatDuration, formatNumber, formatUsd } from "@/lib/format";

export default async function OverviewPage() {
  const source = data();
  const [trends, usage, reviews, repos] = await Promise.all([
    source.getTrends("30d"),
    source.getUsage("30d"),
    source.listReviews({ limit: 8 }),
    source.listRepos(),
  ]);

  const { totals } = trends;
  const highShare =
    totals.findings > 0 ? Math.round((totals.bySeverity.high / totals.findings) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        description={`${source.team.name} — every review the agents published in the last 30 days, newest first.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/repos">All repositories</Link>
          </Button>
        }
      />

      <StatGrid className="mt-8">
        <Stat label="Reviews / 30d" value={formatNumber(totals.reviews)} hint="one per head SHA">
          <Sparkline points={trends.points} label="Daily review volume over the last 30 days" />
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
        <Stat
          label="Spend / 30d"
          value={formatUsd(usage.totals.costUsd)}
          hint={`${formatNumber(usage.totals.reviewCount)} billed reviews`}
        />
      </StatGrid>

      <Section title="Recent reviews">
        <Card padding="table">
          {reviews.length > 0 ? (
            <ReviewsTable
              reviews={reviews}
              caption="The eight most recent reviews, newest first."
            />
          ) : (
            <EmptyState
              title="No reviews yet"
              description="Once the action runs on a pull request, the review lands here."
            />
          )}
        </Card>
      </Section>

      <Section
        title="Repositories at a glance"
        action={
          <Link
            href="/repos"
            className="font-mono text-caption text-accent no-underline hover:underline"
          >
            View all →
          </Link>
        }
      >
        <Card padding="table">
          {repos.length > 0 ? (
            <RepoTable
              repos={repos}
              limit={6}
              caption="Repositories connected to this team, most recently reviewed first."
            />
          ) : (
            <EmptyState
              title="No repositories connected"
              description="Add the review workflow to a repository to see it here."
            />
          )}
        </Card>
      </Section>
    </>
  );
}
