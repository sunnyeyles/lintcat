import {
  cn,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";

import type { ReviewSummary } from "@pr-review/db/dashboard";
import { Code, RepoName, RiskBadge } from "@/components/ui";
import { formatDuration, formatRelative, formatUsd, shortSha } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

import { RowLink } from "./row-link";
import { SeverityMix } from "./severity-mix";

export function HeadCell({ sha }: { sha: string }) {
  return (
    <TableCell className="whitespace-nowrap">
      <Code className="text-sm">{shortSha(sha)}</Code>
    </TableCell>
  );
}

export function RiskCell({ risk }: { risk: ReviewSummary["risk"] }) {
  return (
    <TableCell>
      {risk ? (
        <RiskBadge band={risk.band} score={risk.score} />
      ) : (
        <span className="text-muted-foreground">
          <span aria-hidden>—</span>
          <span className="sr-only">not scored</span>
        </span>
      )}
    </TableCell>
  );
}

export function FindingsCell({ bySeverity }: Pick<ReviewSummary, "bySeverity">) {
  return (
    <TableCell>
      <SeverityMix bySeverity={bySeverity} />
    </TableCell>
  );
}

export function DurationCell({ ms }: { ms: number }) {
  return (
    <TableCell className="text-right tabular-nums whitespace-nowrap">
      {formatDuration(ms)}
    </TableCell>
  );
}

export function CostCell({ usd }: { usd: number }) {
  return <TableCell className="text-right tabular-nums">{formatUsd(usd)}</TableCell>;
}

export function WhenCell({ date }: { date: Date }) {
  return (
    <TableCell className="text-right whitespace-nowrap">
      <time dateTime={date.toISOString()}>{formatRelative(date)}</time>
    </TableCell>
  );
}

function NumericHead({ children }: { children: string }) {
  return (
    <TableHead scope="col" className="text-right">
      {children}
    </TableHead>
  );
}

export type ReviewColumn = "head" | "risk" | "cost";

export type ReviewsTableProps = {
  slug: string;
  reviews: ReviewSummary[];
  caption: string;
  /** Columns beyond repository, pull request, findings, duration and when. */
  columns?: readonly ReviewColumn[];
};

export function ReviewsTable({ slug, reviews, caption, columns = [] }: ReviewsTableProps) {
  const show = (column: ReviewColumn) => columns.includes(column);

  return (
    <Table className={cn(columns.length > 0 ? "min-w-[54rem]" : "min-w-[38rem]")}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Repository</TableHead>
          <TableHead scope="col">Pull request</TableHead>
          {show("head") ? <TableHead scope="col">Head</TableHead> : null}
          {show("risk") ? (
            <TableHead scope="col" className="w-[7rem]">
              Blast radius
            </TableHead>
          ) : null}
          <TableHead scope="col">Findings</TableHead>
          <NumericHead>Duration</NumericHead>
          {show("cost") ? <NumericHead>Cost</NumericHead> : null}
          <NumericHead>When</NumericHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((review) => (
          <TableRow key={review.id} className="group relative">
            <TableCell className="whitespace-nowrap">
              <RepoName owner={review.repo.owner} name={review.repo.name} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <RowLink
                href={organizationPath(slug, `/reviews/${review.id}`)}
                aria-label={`Review of ${review.repo.owner}/${review.repo.name} pull request ${review.prNumber}`}
              >
                #{review.prNumber}
              </RowLink>
            </TableCell>
            {show("head") ? <HeadCell sha={review.headSha} /> : null}
            {show("risk") ? <RiskCell risk={review.risk} /> : null}
            <FindingsCell bySeverity={review.bySeverity} />
            <DurationCell ms={review.durationMs} />
            {show("cost") ? <CostCell usd={review.costUsd} /> : null}
            <WhenCell date={review.createdAt} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
