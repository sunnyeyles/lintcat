import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";

import type { ReviewSummary } from "@pr-review/db/dashboard";
import { formatDuration, formatRelative } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

import { AgentChips } from "./agent-chips";
import { RowLink } from "./row-link";
import { SeverityMix } from "./severity-mix";

export type ReviewsTableProps = {
  slug: string;
  reviews: ReviewSummary[];
  caption: string;
};

export function ReviewsTable({ slug, reviews, caption }: ReviewsTableProps) {
  return (
    <Table className="min-w-[38rem]">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Repository</TableHead>
          <TableHead scope="col">Pull request</TableHead>
          <TableHead scope="col">Findings</TableHead>
          <TableHead scope="col">Agents</TableHead>
          <TableHead scope="col" className="text-right">
            Duration
          </TableHead>
          <TableHead scope="col" className="text-right">
            When
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((review) => (
          <TableRow key={review.id} className="group relative">
            <TableCell className="whitespace-nowrap">
              <span className="text-slate">{review.repo.owner}/</span>
              <span className="text-ink">{review.repo.name}</span>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <RowLink
                href={organizationPath(slug, `/reviews/${review.id}`)}
                aria-label={`Review of ${review.repo.owner}/${review.repo.name} pull request ${review.prNumber}`}
              >
                #{review.prNumber}
              </RowLink>
            </TableCell>
            <TableCell>
              <SeverityMix bySeverity={review.bySeverity} />
            </TableCell>
            <TableCell>
              <AgentChips agents={review.agents} />
            </TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap">
              {formatDuration(review.durationMs)}
            </TableCell>
            <TableCell className="text-right whitespace-nowrap">
              <time dateTime={review.createdAt.toISOString()}>
                {formatRelative(review.createdAt)}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
