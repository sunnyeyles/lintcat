import { Button, EmptyState } from "@pr-review/design";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AgentRunStrip,
  FindingsTable,
  ReviewPager,
  ReviewSummaryPanel,
} from "@/components/review";
import { PageHeader } from "@/components/shell";
import { data } from "@/lib/data";
import { formatDuration, formatRelative, formatUsd, shortSha } from "@/lib/format";

type PageProps = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const parsed = parseId(id);
  const review = parsed === null ? null : await data().getReview(parsed);
  if (!review) return { title: "Review not found" };
  return { title: `${review.repo.owner}/${review.repo.name} #${review.prNumber}` };
}

export default async function ReviewDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = parseId(id);
  if (parsed === null) notFound();

  const review = await data().getReview(parsed);
  if (!review) notFound();

  const siblings = await data().listReviews({ repoId: review.repoId });
  const at = siblings.findIndex((r) => r.id === review.id);
  const newer = at > 0 ? (siblings[at - 1] ?? null) : null;
  const older = at >= 0 ? (siblings[at + 1] ?? null) : null;

  const repoHref = `/repos/${review.repo.owner}/${review.repo.name}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Review"
        title={`${review.repo.owner}/${review.repo.name} #${review.prNumber}`}
        description={
          <>
            <code className="rounded-xs border border-rule-soft bg-surface-2 px-1 py-0.5 text-ink">
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
          <Button asChild variant="outline" size="sm">
            <Link href={repoHref}>
              <ArrowLeft />
              {review.repo.owner}/{review.repo.name}
            </Link>
          </Button>
        }
      />

      <ReviewSummaryPanel summary={review.summary} bySeverity={review.bySeverity} />

      {review.runs.length > 0 ? <AgentRunStrip runs={review.runs} /> : null}

      {review.findings.length === 0 ? (
        <EmptyState
          className="border-ok/40 bg-ok/5"
          icon={<ShieldCheck className="text-ok" />}
          title="Nothing survived validation on this head"
          description="Every agent ran and every candidate finding was dropped before publish. That is the clean outcome, not a failure."
        />
      ) : (
        <FindingsTable findings={review.findings} />
      )}

      <ReviewPager newer={newer} older={older} />
    </div>
  );
}
