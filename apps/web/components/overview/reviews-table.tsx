import {
  Badge,
  cn,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import type { ReactNode } from "react";

import type { ReviewSummary } from "@pr-review/db/dashboard";
import { RiskBadge } from "@/components/ui";
import { formatDuration, formatRelative, formatUsd, shortSha } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

import { RowLink } from "./row-link";
import { SeverityMix } from "./severity-mix";

export type ReviewRow = Pick<
  ReviewSummary,
  "id" | "prNumber" | "headSha" | "bySeverity" | "durationMs" | "costUsd" | "createdAt"
> & {
  repo: Pick<ReviewSummary["repo"], "owner" | "name">;
  risk: Pick<NonNullable<ReviewSummary["risk"]>, "band" | "score"> | null;
};

export function toReviewRow(review: ReviewSummary): ReviewRow {
  return {
    id: review.id,
    prNumber: review.prNumber,
    headSha: review.headSha,
    bySeverity: review.bySeverity,
    durationMs: review.durationMs,
    costUsd: review.costUsd,
    createdAt: review.createdAt,
    repo: { owner: review.repo.owner, name: review.repo.name },
    risk: review.risk ? { band: review.risk.band, score: review.risk.score } : null,
  };
}

export type ReviewColumn =
  | "repository"
  | "pullRequest"
  | "head"
  | "risk"
  | "findings"
  | "duration"
  | "cost"
  | "ran";

// Set only when grouped: this row's place among its pull request's reviews.
type Revision = { number: number; of: number };

type CellProps = { slug: string; row: ReviewRow; revision?: Revision };

function PullRequestCell({ slug, row, revision }: CellProps) {
  const target = `${row.repo.owner}/${row.repo.name} pull request ${row.prNumber}`;
  return (
    <>
      <RowLink
        href={organizationPath(slug, `/reviews/${row.id}`)}
        aria-label={
          revision
            ? `Review ${revision.number} of ${revision.of} for ${target}`
            : `Review of ${target}`
        }
      >
        #{row.prNumber}
      </RowLink>
      {revision ? (
        <span className="text-muted-foreground ml-2 font-mono text-xs">rev {revision.number}</span>
      ) : null}
    </>
  );
}

function RiskCell({ row }: CellProps) {
  return row.risk ? (
    <RiskBadge band={row.risk.band} score={row.risk.score} />
  ) : (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">not scored</span>
    </span>
  );
}

const COLUMNS: Record<
  ReviewColumn,
  { header: string; align?: "right"; className?: string; Cell: (props: CellProps) => ReactNode }
> = {
  repository: {
    header: "Repository",
    className: "whitespace-nowrap",
    Cell: ({ row }) => (
      <>
        <span className="text-muted-foreground">{row.repo.owner}/</span>
        <span className="text-foreground">{row.repo.name}</span>
      </>
    ),
  },
  pullRequest: { header: "Pull request", className: "whitespace-nowrap", Cell: PullRequestCell },
  head: {
    header: "Head",
    className: "whitespace-nowrap",
    Cell: ({ row }) => (
      <code className="rounded-sm border border-border bg-muted px-1 py-0.5 text-sm">
        {shortSha(row.headSha)}
      </code>
    ),
  },
  risk: { header: "Blast radius", className: "whitespace-nowrap", Cell: RiskCell },
  findings: {
    header: "Findings",
    Cell: ({ row }) => <SeverityMix bySeverity={row.bySeverity} />,
  },
  duration: {
    header: "Duration",
    align: "right",
    className: "tabular-nums whitespace-nowrap",
    Cell: ({ row }) => formatDuration(row.durationMs),
  },
  cost: {
    header: "Cost",
    align: "right",
    className: "tabular-nums whitespace-nowrap",
    Cell: ({ row }) => formatUsd(row.costUsd),
  },
  ran: {
    header: "When",
    align: "right",
    className: "whitespace-nowrap",
    Cell: ({ row }) => (
      <time dateTime={row.createdAt.toISOString()}>{formatRelative(row.createdAt)}</time>
    ),
  },
};

function ReviewTableRow({
  slug,
  row,
  columns,
  revision,
}: CellProps & { columns: readonly ReviewColumn[] }) {
  return (
    <TableRow className="group relative">
      {columns.map((column, index) => {
        const { align, className, Cell } = COLUMNS[column];
        return (
          <TableCell
            key={column}
            className={cn(
              align === "right" && "text-right",
              className,
              index === 0 && revision && "border-l-2 border-primary/30 pl-3",
            )}
          >
            <Cell slug={slug} row={row} revision={revision} />
          </TableCell>
        );
      })}
    </TableRow>
  );
}

// Input is newest-first, so insertion order already ranks groups by latest review.
export function groupByPr<T extends { prNumber: number }>(rows: readonly T[]): T[][] {
  const byPr = new Map<number, T[]>();
  for (const row of rows) {
    const existing = byPr.get(row.prNumber);
    if (existing) existing.push(row);
    else byPr.set(row.prNumber, [row]);
  }
  return [...byPr.values()];
}

export type ReviewsTableProps = {
  slug: string;
  rows: readonly ReviewRow[];
  columns: readonly ReviewColumn[];
  caption: string;
  // Rows of one repository only: a PR number is not unique across repositories.
  groupByPullRequest?: boolean;
};

export function ReviewsTable({
  slug,
  rows,
  columns,
  caption,
  groupByPullRequest = false,
}: ReviewsTableProps) {
  return (
    <Table className={columns.length > 5 ? "min-w-[54rem]" : "min-w-[38rem]"}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column}
              scope="col"
              className={cn(COLUMNS[column].align === "right" && "text-right")}
            >
              {COLUMNS[column].header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {groupByPullRequest ? (
        groupByPr(rows).map((group) => (
          <TableBody
            key={group[0]!.prNumber}
            className={cn(group.length > 1 && "border-b border-border last:border-b-0")}
          >
            {group.length > 1 ? (
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={columns.length}
                  className="pt-4 pb-1.5 text-left font-mono text-sm font-medium"
                >
                  PR #{group[0]!.prNumber}{" "}
                  <Badge variant="secondary" className="ml-1.5">
                    {group.length} reviews
                  </Badge>
                </th>
              </tr>
            ) : null}
            {group.map((row, index) => (
              <ReviewTableRow
                key={row.id}
                slug={slug}
                row={row}
                columns={columns}
                {...(group.length > 1
                  ? { revision: { number: group.length - index, of: group.length } }
                  : {})}
              />
            ))}
          </TableBody>
        ))
      ) : (
        <TableBody>
          {rows.map((row) => (
            <ReviewTableRow key={row.id} slug={slug} row={row} columns={columns} />
          ))}
        </TableBody>
      )}
    </Table>
  );
}
