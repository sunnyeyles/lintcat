import {
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pr-review/design";

import { RepoTable } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { data } from "@/lib/data/server";
import { formatNumber } from "@/lib/format";

export default async function ReposPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const repos = await (await data(slug)).listRepos();
  const reviewCount = repos.reduce((n, repo) => n + repo.reviewCount, 0);

  return (
    <>
      <PageHeader
        eyebrow="Repositories"
        title="Repositories"
        description={
          repos.length > 0
            ? `${formatNumber(repos.length)} connected repositories, ${formatNumber(reviewCount)} reviews all time. Most recently reviewed first.`
            : "No repositories are connected to this organization yet."
        }
      />

      <div className="mt-8">
        {repos.length > 0 ? (
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
        )}
      </div>
    </>
  );
}
