import { cn } from "@pr-review/design";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";

import type { ReviewSummary } from "@/lib/data";

export type ReviewPagerProps = {
  newer: ReviewSummary | null;
  older: ReviewSummary | null;
};

function PagerLink({
  review,
  direction,
}: {
  review: ReviewSummary;
  direction: "newer" | "older";
}) {
  const newer = direction === "newer";
  const Icon = newer ? ArrowLeft : ArrowRight;
  return (
    <Link
      href={`/reviews/${review.id}`}
      className={cn(
        "group flex min-w-0 flex-1 basis-56 items-center gap-2.5 rounded-sm border border-rule bg-surface px-3.5 py-3 transition-colors outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        newer ? "" : "flex-row-reverse text-right",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-slate-dim group-hover:text-accent" />
      <span className="min-w-0">
        <span className="eyebrow block font-mono">{newer ? "Newer" : "Older"}</span>
        <span className="block truncate font-mono text-body text-ink">
          {review.repo.owner}/{review.repo.name} #{review.prNumber}
        </span>
      </span>
    </Link>
  );
}

export function ReviewPager({ newer, older }: ReviewPagerProps) {
  if (!newer && !older) return null;
  return (
    <nav aria-label="Adjacent reviews" className="flex flex-wrap gap-3">
      {newer ? <PagerLink review={newer} direction="newer" /> : <span className="flex-1 basis-56" />}
      {older ? <PagerLink review={older} direction="older" /> : <span className="flex-1 basis-56" />}
    </nav>
  );
}
