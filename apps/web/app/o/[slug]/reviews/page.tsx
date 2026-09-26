import { Card, EmptyState, Skeleton } from "@pr-review/design";
import { GitPullRequest } from "lucide-react";
import type { Metadata } from "next";
import { cache, Suspense } from "react";

import { ReviewsTable } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { TableCardSkeleton } from "@/components/ui";
import { data } from "@/lib/data/server";

export const metadata: Metadata = { title: "Reviews" };

// Shared by the header summary and the table, so both read one query.
const recentReviews = cache(async (slug: string) =>
  (await data(slug)).listReviews({ limit: 50 }),
);

async function ReviewsSummary({ slug }: { slug: string }) {
  const reviews = await recentReviews(slug);
  return `The last ${reviews.length} runs across every repository, newest first. Open one to read what the review found.`;
}

async function ReviewsBody({ slug }: { slug: string }) {
  const reviews = await recentReviews(slug);

  return reviews.length === 0 ? (
    <EmptyState
      icon={<GitPullRequest />}
      title="No reviews yet"
      description="Once a pull request event reaches the pipeline, its review lands here."
    />
  ) : (
    <Card className="py-0">
      <ReviewsTable
        slug={slug}
        reviews={reviews}
        columns={["head", "risk", "cost"]}
        caption="The most recent reviews across every repository, newest first."
      />
    </Card>
  );
}

export default async function ReviewsIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Reviews"
        title="Recent reviews"
        description={
          <Suspense fallback={<Skeleton as="span" className="h-4 w-96 max-w-full" />}>
            <ReviewsSummary slug={slug} />
          </Suspense>
        }
      />

      <Suspense fallback={<TableCardSkeleton rows={10} columns={8} />}>
        <ReviewsBody slug={slug} />
      </Suspense>
    </div>
  );
}
