import {
  Button,
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pr-review/design";
import Link from "next/link";

import { RepoTable, ReviewsTable, Section, Sparkline } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatDuration, formatNumber, formatUsd } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const source = await data((await params).slug);
  const { slug } = source.organization;
  const [trends, usage, reviews, repos] = await Promise.all([
    source.getTrends("30d"),
    source.getUsage("30d"),
    source.listReviews({ limit: 8 }),
    source.listRepos(),
  ]);

  const { totals } = trends;
  const highShare =
    totals.findings > 0
      ? Math.round((totals.bySeverity.high / totals.findings) * 100)
      : 0;

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
        <Stat
          label="Spend / 30d"
          value={formatUsd(usage.totals.costUsd)}
          hint={`${formatNumber(usage.totals.reviewCount)} billed reviews`}
        />
      </StatGrid>

      <Section title="Recent reviews">
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
      </Section>

      <Section
        title="Repositories at a glance"
        action={
          <Link
            href={organizationPath(slug, "/repos")}
            className="text-primary font-mono text-xs no-underline hover:underline"
          >
            View all →
          </Link>
        }
      >
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
      </Section>
    </>
  );
}
