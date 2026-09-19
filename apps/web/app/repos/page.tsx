import { Card, EmptyState } from "@pr-review/design";

import { RepoTable } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { data } from "@/lib/data/server";
import { formatNumber } from "@/lib/format";

export default async function ReposPage() {
  const repos = await (await data()).listRepos();
  const reviewCount = repos.reduce((n, repo) => n + repo.reviewCount, 0);

  return (
    <>
      <PageHeader
        eyebrow="Repositories"
        title="Repositories"
        description={
          repos.length > 0
            ? `${formatNumber(repos.length)} connected repositories, ${formatNumber(reviewCount)} reviews all time. Most recently reviewed first.`
            : "No repositories are connected to this team yet."
        }
      />

      <div className="mt-8">
        {repos.length > 0 ? (
          <Card padding="table">
            <RepoTable
              repos={repos}
              caption="All connected repositories, most recently reviewed first."
            />
          </Card>
        ) : (
          <EmptyState
            title="No repositories yet"
            description="Install the review workflow on a repository and its first review will appear here."
          />
        )}
      </div>
    </>
  );
}
