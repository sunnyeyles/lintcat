import {
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import { GitPullRequest } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";

import { SEVERITIES } from "@/components/review";
import { PageHeader } from "@/components/shell";
import { InlineSkeleton, SeverityBadge, TableCardSkeleton } from "@/components/ui";
import { data } from "@/lib/data/server";
import { formatDuration, formatRelative, formatUsd, shortSha } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

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
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitPullRequest />
        </EmptyMedia>
        <EmptyTitle>No reviews yet</EmptyTitle>
        <EmptyDescription>
          Once a pull request event reaches the pipeline, its review lands here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : (
    <Card className="py-0">
      <Table className="min-w-[48rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Pull request</TableHead>
            <TableHead>Head</TableHead>
            <TableHead>Findings</TableHead>
            <TableHead className="w-[6rem]">Duration</TableHead>
            <TableHead className="w-[5.5rem]">Cost</TableHead>
            <TableHead className="w-[6rem]">Ran</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reviews.map((review) => (
            <TableRow key={review.id}>
              <TableCell>
                <Link
                  href={organizationPath(slug, `/reviews/${review.id}`)}
                  className="focus-visible:ring-ring underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-2"
                >
                  {review.repo.owner}/{review.repo.name} #{review.prNumber}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {shortSha(review.headSha)}
              </TableCell>
              <TableCell>
                {review.findingCount === 0 ? (
                  <span className="text-muted-foreground">clean</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {SEVERITIES.filter((s) => review.bySeverity[s] > 0).map((s) => (
                      <SeverityBadge key={s} severity={s} count={review.bySeverity[s]} />
                    ))}
                  </span>
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatDuration(review.durationMs)}
              </TableCell>
              <TableCell className="tabular-nums">{formatUsd(review.costUsd)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <time dateTime={review.createdAt.toISOString()}>
                  {formatRelative(review.createdAt)}
                </time>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
          <Suspense fallback={<InlineSkeleton className="h-4 w-96 max-w-full" />}>
            <ReviewsSummary slug={slug} />
          </Suspense>
        }
      />

      <Suspense fallback={<TableCardSkeleton rows={10} columns={6} />}>
        <ReviewsBody slug={slug} />
      </Suspense>
    </div>
  );
}
