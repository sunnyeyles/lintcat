import type { ReviewSummary } from "@pr-review/db/dashboard";

import { PagerCard } from "@/components/ui/pager-card";
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
  return (
    <PagerCard
      href={organizationPath(slug, `/reviews/${review.id}`)}
      direction={newer ? "back" : "forward"}
      label={newer ? "Newer" : "Older"}
    >
      <span className="font-mono text-sm">
        {review.repo.owner}/{review.repo.name} #{review.prNumber}
      </span>
    </PagerCard>
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
