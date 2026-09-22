import {
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pr-review/design";
import { cache, Suspense } from "react";

import { RepoTable } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { InlineSkeleton, TableCardSkeleton } from "@/components/ui";
import { data } from "@/lib/data/server";
import { formatNumber } from "@/lib/format";

// Shared by the header summary and the table, so both read one query.
const repoList = cache(async (slug: string) => (await data(slug)).listRepos());

async function ReposSummary({ slug }: { slug: string }) {
  const repos = await repoList(slug);
  const reviewCount = repos.reduce((n, repo) => n + repo.reviewCount, 0);
  return repos.length > 0
    ? `${formatNumber(repos.length)} connected repositories, ${formatNumber(reviewCount)} reviews all time. Most recently reviewed first.`
    : "No repositories are connected to this organization yet.";
}

async function ReposBody({ slug }: { slug: string }) {
  const repos = await repoList(slug);
  return repos.length > 0 ? (
    <Card className="py-0">
      <RepoTable
        slug={slug}
        repos={repos}
        caption="All connected repositories, most recently reviewed first."
      />
    </Card>
  ) : (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No repositories yet</EmptyTitle>
        <EmptyDescription>
          Install the review workflow on a repository and its first review will
          appear here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export default async function ReposPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <>
      <PageHeader
        eyebrow="Repositories"
        title="Repositories"
        description={
          <Suspense fallback={<InlineSkeleton className="h-4 w-80 max-w-full" />}>
            <ReposSummary slug={slug} />
          </Suspense>
        }
      />

      <div className="mt-8">
        <Suspense fallback={<TableCardSkeleton rows={8} columns={6} />}>
          <ReposBody slug={slug} />
        </Suspense>
      </div>
    </>
  );
}
