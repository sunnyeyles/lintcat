import { Button, EmptyState } from "@pr-review/design";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  FindingsFocusProvider,
  FindingsTable,
  ReviewMapSection,
  ReviewMapSkeleton,
  ReviewPager,
  ReviewSummaryPanel,
} from "@/components/review";
import { PageHeader } from "@/components/shell";
import { Code } from "@/components/ui";
import { data } from "@/lib/data/server";
import { formatDuration, formatRelative, formatUsd, shortSha } from "@/lib/format";
import { organizationPath } from "@/lib/paths";
import { parseReviewId } from "@/lib/review-id";

type PageProps = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const parsed = parseReviewId(id);
  const review = parsed === null ? null : await (await data(slug)).getReview(parsed);
  if (!review) return { title: "Review not found" };
  return { title: `${review.repo.owner}/${review.repo.name} #${review.prNumber}` };
}

async function AdjacentReviews({
  slug,
  repoId,
  reviewId,
}: {
  slug: string;
  repoId: number;
  reviewId: number;
}) {
  const siblings = await (await data(slug)).listReviews({ repoId });
  const at = siblings.findIndex((r) => r.id === reviewId);
  const newer = at > 0 ? (siblings[at - 1] ?? null) : null;
  const older = at >= 0 ? (siblings[at + 1] ?? null) : null;
  return <ReviewPager slug={slug} newer={newer} older={older} />;
}

export default async function ReviewDetailPage({ params }: PageProps) {
  const { slug, id } = await params;
  const parsed = parseReviewId(id);
  if (parsed === null) notFound();

  const review = await (await data(slug)).getReview(parsed);
  if (!review) notFound();

  const repoHref = organizationPath(slug, `/repos/${review.repo.owner}/${review.repo.name}`);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Review"
        size="record"
        title={`${review.repo.owner}/${review.repo.name} #${review.prNumber}`}
        description={
          <>
            <Code className="text-foreground">{shortSha(review.headSha)}</Code>{" "}
            · ran{" "}
            <time dateTime={review.createdAt.toISOString()}>
              {formatRelative(review.createdAt)}
            </time>{" "}
            · took {formatDuration(review.durationMs)} · {formatUsd(review.costUsd)}
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={repoHref}>
              <ArrowLeft />
              {review.repo.owner}/{review.repo.name}
            </Link>
          </Button>
        }
      />

      <ReviewSummaryPanel
        summary={review.summary}
        bySeverity={review.bySeverity}
        risk={review.risk}
      />

      <FindingsFocusProvider>
        <Suspense fallback={<ReviewMapSkeleton />}>
          <ReviewMapSection
            slug={slug}
            reviewId={review.id}
            findings={review.findings}
            dependents={review.risk?.dependents}
          />
        </Suspense>

        {review.findings.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="Nothing survived validation on this head"
            description="The reviewer ran and every candidate finding was dropped before publish. That is the clean outcome, not a failure."
          />
        ) : (
          <FindingsTable findings={review.findings} />
        )}
      </FindingsFocusProvider>

      <Suspense fallback={null}>
        <AdjacentReviews slug={slug} repoId={review.repoId} reviewId={review.id} />
      </Suspense>
    </div>
  );
}
