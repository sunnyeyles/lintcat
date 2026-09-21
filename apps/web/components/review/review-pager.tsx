import { cn } from "@pr-review/design";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";

import type { ReviewSummary } from "@pr-review/db/dashboard";
import { organizationPath } from "@/lib/paths";

export type ReviewPagerProps = {
  slug: string;
  newer: ReviewSummary | null;
  older: ReviewSummary | null;
};

function PagerLink({
  slug,
  review,
  direction,
}: {
  slug: string;
  review: ReviewSummary;
  direction: "newer" | "older";
}) {
  const newer = direction === "newer";
  const Icon = newer ? ArrowLeft : ArrowRight;
  return (
    <Link
      href={organizationPath(slug, `/reviews/${review.id}`)}
      className={cn(
        "group flex min-w-0 flex-1 basis-56 items-center gap-2.5 rounded-sm border border-border bg-card px-3.5 py-3 transition-colors outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        newer ? "" : "flex-row-reverse text-right",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-link" />
      <span className="min-w-0">
        <span className="text-muted-foreground text-xs tracking-wide uppercase block font-mono">{newer ? "Newer" : "Older"}</span>
        <span className="block truncate font-mono text-sm text-foreground">
          {review.repo.owner}/{review.repo.name} #{review.prNumber}
        </span>
      </span>
    </Link>
  );
}

export function ReviewPager({ slug, newer, older }: ReviewPagerProps) {
  if (!newer && !older) return null;
  return (
    <nav aria-label="Adjacent reviews" className="flex flex-wrap gap-3">
      {newer ? <PagerLink slug={slug} review={newer} direction="newer" /> : <span className="flex-1 basis-56" />}
      {older ? <PagerLink slug={slug} review={older} direction="older" /> : <span className="flex-1 basis-56" />}
    </nav>
  );
}
