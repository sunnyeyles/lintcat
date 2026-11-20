import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import Link from "next/link";

import type { WorkflowRunSummary } from "@pr-review/db/dashboard";
import { RowLink } from "@/components/overview";
import { ciFiltersQuery, type CiFilters } from "@/lib/ci-filters";
import { formatDuration, formatRelative, shortSha } from "@/lib/format";

import { ConclusionBadge } from "./conclusion-badge";

export type WorkflowRunsTableProps = {
  // The repo's CI page, which run links and filter links hang off.
  ciHref: string;
  filters: CiFilters;
  runs: WorkflowRunSummary[];
  caption: string;
};

// Raised above the row's RowLink overlay so it stays clickable.
const INNER_LINK = "relative z-10 underline-offset-2 hover:underline";

export function WorkflowRunsTable({ ciHref, filters, runs, caption }: WorkflowRunsTableProps) {
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Workflow</TableHead>
          <TableHead scope="col">Result</TableHead>
          <TableHead scope="col">Branch</TableHead>
          <TableHead scope="col">Commit</TableHead>
          <TableHead scope="col">Trigger</TableHead>
          <TableHead scope="col" className="text-right">
            Duration
          </TableHead>
          <TableHead scope="col">Started</TableHead>
          <TableHead scope="col">
            <span className="sr-only">On GitHub</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id} className="group relative">
            <TableCell className="whitespace-nowrap">
              <RowLink href={`${ciHref}/${run.id}`}>{run.workflowName}</RowLink>
              {run.runAttempt > 1 ? (
                <Badge variant="secondary" className="ml-2 tabular-nums">
                  attempt {run.runAttempt}
                </Badge>
              ) : null}
            </TableCell>
            <TableCell>
              <ConclusionBadge status={run.status} conclusion={run.conclusion} />
            </TableCell>
            <TableCell className="max-w-48 truncate font-mono text-xs">
              {run.headBranch ? (
                <Link
                  href={`${ciHref}${ciFiltersQuery({ ...filters, branch: run.headBranch })}`}
                  className={INNER_LINK}
                  title={`Only runs on ${run.headBranch}`}
                >
                  {run.headBranch}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {shortSha(run.headSha)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {run.event.replace(/_/g, " ")}
              {run.prNumber === null ? null : ` #${run.prNumber}`}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {run.durationMs === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                formatDuration(run.durationMs)
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <time dateTime={run.runStartedAt.toISOString()}>
                {formatRelative(run.runStartedAt)}
              </time>
            </TableCell>
            <TableCell className="text-right">
              <a
                href={run.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${INNER_LINK} text-link text-xs`}
                aria-label={`${run.workflowName} run on GitHub`}
              >
                GitHub ↗
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
