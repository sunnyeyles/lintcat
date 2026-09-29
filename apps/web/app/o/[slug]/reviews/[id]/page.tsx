import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pr-review/design";
import { ArrowLeft, ShieldCheck } from "@pr-review/design/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  ChangeDiagramSection,
  ChangeDiagramSkeleton,
  FindingsSection,
  FindingsTable,
  ReviewMapSection,
  ReviewMapSkeleton,
  ReviewPager,
  ReviewSummaryPanel,
  ReviewTabs,
} from "@/components/review";
import { PageHeader } from "@/components/shell";
import { data, loadMapSource } from "@/lib/data/server";
import { formatDuration, formatRelative, formatUsd, shortSha } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

type PageProps = { params: Promise<{ slug: string; id: string }> };

const nothingSurvived = (
  <FindingsSection>
    <Empty className="rounded-lg border border-dashed border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldCheck />
        </EmptyMedia>
        <EmptyTitle>Nothing survived validation on this head</EmptyTitle>
        <EmptyDescription>
          The reviewer ran and every candidate finding was dropped before publish.
          That is the clean outcome, not a failure.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </FindingsSection>
);

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1 ? id : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const parsed = parseId(id);
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
  const parsed = parseId(id);
  if (parsed === null) notFound();

  const review = await (await data(slug)).getReview(parsed);
  if (!review) notFound();

  const repoHref = organizationPath(slug, `/repos/${review.repo.owner}/${review.repo.name}`);
  // Started once, unawaited, so both sections share one graph decode.
  const mapSource = loadMapSource(slug, review.id).then(
    (source) => source ?? { graph: undefined, heat: {}, changedPaths: [] },
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Review"
        size="record"
        title={`${review.repo.owner}/${review.repo.name} #${review.prNumber}`}
        description={
          <>
            <code className="rounded-sm border border-border bg-muted px-1 py-0.5 text-foreground">
              {shortSha(review.headSha)}
            </code>{" "}
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

      <ReviewTabs
        findingCount={review.findings.length}
        findings={
          review.findings.length === 0 ? (
            nothingSurvived
          ) : (
            <FindingsTable
              findings={review.findings}
              source={{
                owner: review.repo.owner,
                repo: review.repo.name,
                sha: review.baseSha ?? review.headSha,
              }}
            />
          )
        }
        change={
          <Suspense fallback={<ChangeDiagramSkeleton />}>
            <ChangeDiagramSection
              source={mapSource}
              changedFiles={review.changedFiles}
              findingCount={review.findings.length}
            />
          </Suspense>
        }
        map={
          <Suspense fallback={<ReviewMapSkeleton />}>
            <ReviewMapSection slug={slug} reviewId={review.id} source={mapSource} />
          </Suspense>
        }
      />

      <Suspense fallback={null}>
        <AdjacentReviews slug={slug} repoId={review.repoId} reviewId={review.id} />
      </Suspense>
    </div>
  );
}
