import { db, findModelKeySummary } from "@pr-review/db";
import { Alert, AlertDescription, AlertTitle, Card, cn } from "@pr-review/design";
import { KeyRound } from "@pr-review/design/icons";
import Link from "next/link";
import { Suspense } from "react";

import {
  EmptyNotice,
  RepoTable,
  ReviewsTable,
  Section,
  toReviewRow,
  ViewAllLink,
  type ReviewColumn,
} from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { InlineSkeleton, TableCardSkeleton } from "@/components/ui";
import { data } from "@/lib/data/server";
import { installAppUrl } from "@/lib/github-app";
import { formatDuration, formatNumber, formatUsd } from "@/lib/format";
import { organizationPath } from "@/lib/paths";
import { requireOrganization } from "@/lib/session";

const RECENT_LIMIT = 5;

const RECENT_COLUMNS: readonly ReviewColumn[] = [
  "repository",
  "pullRequest",
  "risk",
  "findings",
  "ran",
];

// Spend comes from the same review rows as the counts, so one query answers the whole line.
async function SummaryLine({ slug }: { slug: string }) {
  const { totals } = await (await data(slug)).getTrends("30d");
  const items: { label: string; value: string; alert?: boolean }[] = [
    { label: "reviews", value: formatNumber(totals.reviews) },
    { label: "findings", value: formatNumber(totals.findings) },
    {
      label: "high severity",
      value: formatNumber(totals.bySeverity.high),
      alert: totals.bySeverity.high > 0,
    },
    { label: "median duration", value: formatDuration(totals.medianDurationMs) },
    { label: "spend", value: formatUsd(totals.costUsd) },
  ];

  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
      <dt className="sr-only">Window</dt>
      <dd className="text-muted-foreground font-mono text-xs tracking-wide uppercase">
        Last 30 days
      </dd>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground order-last">{item.label}</dt>
          <dd
            className={cn(
              "font-semibold tabular-nums",
              item.alert ? "text-destructive" : "text-foreground",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function ModelKeyNudge({ slug }: { slug: string }) {
  const { organization, role } = await requireOrganization(slug);
  if (role !== "owner" || (await findModelKeySummary(db(), organization.id))) return null;
  return (
    <Alert className="mt-8">
      <KeyRound />
      <AlertTitle>Add a model key to start reviews</AlertTitle>
      <AlertDescription>
        <p>
          Reviews run on your own Anthropic or OpenAI key, and nothing is reviewed until one
          is saved.{" "}
          <Link href={organizationPath(slug, "/settings")}>Add a model key</Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}

async function RecentReviews({ slug }: { slug: string }) {
  const source = await data(slug);
  const reviews = await source.listReviews({ limit: RECENT_LIMIT });
  return (
    <Card className="py-0">
      {reviews.length > 0 ? (
        <ReviewsTable
          slug={slug}
          rows={reviews.map(toReviewRow)}
          columns={RECENT_COLUMNS}
          caption="The five most recent reviews, newest first."
        />
      ) : (
        <EmptyNotice
          title="No reviews yet"
          sentence="Open a pull request on a connected repository and its review lands here."
          action={{
            label: "Connect a repository",
            href: installAppUrl(source.organization.githubAccountId),
          }}
        />
      )}
    </Card>
  );
}

async function ReposGlance({ slug }: { slug: string }) {
  const source = await data(slug);
  const repos = await source.listRepos();
  return (
    <Card className="py-0">
      {repos.length > 0 ? (
        <RepoTable
          slug={slug}
          repos={repos}
          limit={6}
          caption="Repositories connected to this account, most recently reviewed first."
        />
      ) : (
        <EmptyNotice
          title="No repositories connected"
          sentence="Give the LintCat GitHub App access to a repository to see it here."
          action={{
            label: "Choose repositories",
            href: installAppUrl(source.organization.githubAccountId),
          }}
        />
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
        description={`${source.organization.name} — what needs your attention, at a glance.`}
      />

      <Suspense fallback={null}>
        <ModelKeyNudge slug={slug} />
      </Suspense>

      <div className="mt-8">
        <Suspense fallback={<InlineSkeleton className="h-5 w-[36rem] max-w-full" />}>
          <SummaryLine slug={slug} />
        </Suspense>
      </div>

      <Section
        title="Recent reviews"
        action={
          <ViewAllLink href={organizationPath(slug, "/reviews")} label="View all reviews" />
        }
      >
        <Suspense fallback={<TableCardSkeleton rows={RECENT_LIMIT} />}>
          <RecentReviews slug={slug} />
        </Suspense>
      </Section>

      <Section
        title="Repositories at a glance"
        action={
          <ViewAllLink
            href={organizationPath(slug, "/repos")}
            label="View all repositories"
          />
        }
      >
        <Suspense fallback={<TableCardSkeleton rows={6} />}>
          <ReposGlance slug={slug} />
        </Suspense>
      </Section>
    </>
  );
}
