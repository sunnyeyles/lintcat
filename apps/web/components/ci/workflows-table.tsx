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

import type { WorkflowTrend } from "@pr-review/db/dashboard";
import { RowLink } from "@/components/overview";
import { ciFiltersQuery } from "@/lib/ci-filters";
import { formatDuration, formatNumber, formatPercent, formatRelative } from "@/lib/format";

import { ConclusionBadge } from "./conclusion-badge";

export type WorkflowsTableProps = {
  ciHref: string;
  workflows: WorkflowTrend[];
  caption: string;
};

function duration(ms: number | null) {
  return ms === null ? <span className="text-muted-foreground">—</span> : formatDuration(ms);
}

export function WorkflowsTable({ ciHref, workflows, caption }: WorkflowsTableProps) {
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Workflow</TableHead>
          <TableHead scope="col" className="text-right">
            Runs
          </TableHead>
          <TableHead scope="col" className="text-right">
            Failure rate
          </TableHead>
          <TableHead scope="col" className="text-right">
            p50
          </TableHead>
          <TableHead scope="col" className="text-right">
            p95
          </TableHead>
          <TableHead scope="col">Last run</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workflows.map((workflow) => (
          <TableRow key={workflow.workflowId} className="group relative">
            <TableCell className="whitespace-nowrap">
              <RowLink
                href={`${ciHref}${ciFiltersQuery({ workflowId: workflow.workflowId })}`}
                aria-label={`Recent runs of ${workflow.workflowName}`}
              >
                {workflow.workflowName}
              </RowLink>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(workflow.runs)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                workflow.failures > 0 ? "font-semibold text-destructive" : "text-muted-foreground",
              )}
            >
              {formatPercent(workflow.failureRate)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {duration(workflow.p50DurationMs)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {duration(workflow.p95DurationMs)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <span className="flex items-center gap-2">
                <ConclusionBadge
                  status={workflow.lastStatus}
                  conclusion={workflow.lastConclusion}
                />
                <time
                  dateTime={workflow.lastRunAt.toISOString()}
                  className="text-muted-foreground"
                >
                  {formatRelative(workflow.lastRunAt)}
                </time>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
