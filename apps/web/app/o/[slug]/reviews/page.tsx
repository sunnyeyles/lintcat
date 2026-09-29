import { Card } from "@pr-review/design";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  EmptyNotice,
  RepoFilterSelect,
  ReviewFilterScope,
  ReviewsTable,
  toReviewRow,
  type ReviewColumn,
} from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { InlineSkeleton, TableCardSkeleton } from "@/components/ui";
import { data } from "@/lib/data/server";
import { installAppUrl } from "@/lib/github-app";
import { organizationPath } from "@/lib/paths";
import {
  isFiltered,
  parseReviewFilters,
  type ReviewFilters,
  reviewListOptions,
} from "@/lib/review-filters";

export const metadata: Metadata = { title: "Reviews" };

const PAGE_LIMIT = 50;

const COLUMNS: readonly ReviewColumn[] = [
  "repository",
  "pullRequest",
  "head",
  "risk",
  "findings",
  "duration",
  "cost",
  "ran",
];

async function RepoFilter({ slug }: { slug: string }) {
  const repos = await (await data(slug)).listRepos();
  return (
    <RepoFilterSelect
      repos={repos.map((repo) => ({ owner: repo.owner, name: repo.name }))}
    />
  );
}

async function ReviewsBody({ slug, filters }: { slug: string; filters: ReviewFilters }) {
  const source = await data(slug);
  const reviews = await source.listReviews({
    ...reviewListOptions(filters),
    limit: PAGE_LIMIT,
  });

  if (reviews.length > 0) {
    return (
      <Card className="py-0">
        <ReviewsTable
          slug={slug}
          rows={reviews.map(toReviewRow)}
          columns={COLUMNS}
          caption={`Up to ${PAGE_LIMIT} reviews matching the filters, newest first.`}
        />
      </Card>
    );
  }

  return (
    <Card className="py-0">
      {isFiltered(filters) ? (
        <EmptyNotice
          title="No matching reviews"
          sentence="No review matches every one of these filters."
          action={{ label: "Clear filters", href: organizationPath(slug, "/reviews") }}
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

export default async function ReviewsIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const filters = parseReviewFilters(query);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Reviews"
        title="Reviews"
        description={`Every review across your repositories, newest first, up to the latest ${PAGE_LIMIT}.`}
      />

      <ReviewFilterScope
        filters={filters}
        repoControl={
          <Suspense fallback={<InlineSkeleton className="h-control w-60" />}>
            <RepoFilter slug={slug} />
          </Suspense>
        }
      >
        <Suspense fallback={<TableCardSkeleton rows={10} columns={COLUMNS.length} />}>
          <ReviewsBody slug={slug} filters={filters} />
        </Suspense>
      </ReviewFilterScope>
    </div>
  );
}
