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

import type { RepoSummary } from "@pr-review/db/dashboard";
import { formatNumber, formatRelative, formatUsd } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

import { RowLink } from "./row-link";

export type RepoTableProps = {
  slug: string;
  repos: RepoSummary[];
  caption: string;
  limit?: number;
};

function byLastReviewed(a: RepoSummary, b: RepoSummary): number {
  return (b.lastReviewedAt?.getTime() ?? 0) - (a.lastReviewedAt?.getTime() ?? 0);
}

export function RepoTable({ slug, repos, caption, limit }: RepoTableProps) {
  const rows = [...repos].sort(byLastReviewed).slice(0, limit ?? repos.length);

  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Repository</TableHead>
          <TableHead scope="col" className="text-right">
            Reviews
          </TableHead>
          <TableHead scope="col" className="text-right">
            Findings
          </TableHead>
          <TableHead scope="col" className="text-right">
            High severity
          </TableHead>
          <TableHead scope="col">Last reviewed</TableHead>
          <TableHead scope="col" className="text-right">
            Spend
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((repo) => (
          <TableRow key={repo.id} className="group relative">
            <TableCell className="whitespace-nowrap">
              <RowLink href={organizationPath(slug, `/repos/${repo.owner}/${repo.name}`)}>
                <span className="text-muted-foreground">{repo.owner}/</span>
                {repo.name}
              </RowLink>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(repo.reviewCount)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(repo.findingCount)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-semibold tabular-nums",
                repo.highSeverity > 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {formatNumber(repo.highSeverity)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {repo.lastReviewedAt ? (
                <time dateTime={repo.lastReviewedAt.toISOString()}>
                  {formatRelative(repo.lastReviewedAt)}
                </time>
              ) : (
                <span className="text-muted-foreground">never</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatUsd(repo.costUsd)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
