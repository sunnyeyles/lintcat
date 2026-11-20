import { cn } from "@pr-review/design";

import type { WorkflowRunDetail } from "@pr-review/db/dashboard";
import { formatDuration } from "@/lib/format";

import { ConclusionBadge, conclusionTone } from "./conclusion-badge";

const BAR_TONE = {
  success: "bg-success/70",
  failure: "bg-destructive/70",
  running: "bg-primary/50",
  neutral: "bg-muted-foreground/40",
} as const;

type WorkflowJob = WorkflowRunDetail["jobs"][number];
type Span = { start: number; end: number };

// A job still running is drawn up to now.
function spanOf(job: WorkflowJob, now: number): Span | null {
  if (!job.startedAt) return null;
  const start = job.startedAt.getTime();
  return { start, end: Math.max(start, job.completedAt?.getTime() ?? now) };
}

export function JobTimeline({ jobs, now = Date.now() }: { jobs: WorkflowJob[]; now?: number }) {
  const spans = jobs.map((job) => spanOf(job, now));
  const known = spans.filter((span): span is Span => span !== null);
  const origin = Math.min(...known.map((s) => s.start));
  const total = Math.max(1, Math.max(...known.map((s) => s.end)) - origin);

  return (
    <ol className="divide-y divide-border">
      {jobs.map((job, i) => {
        const span = spans[i];
        const tone = conclusionTone(job.status, job.conclusion);
        return (
          <li
            key={job.id}
            className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5rem] sm:items-center"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium" title={job.name}>
                {job.name}
              </span>
              <ConclusionBadge status={job.status} conclusion={job.conclusion} />
            </div>
            <div className="relative h-3 rounded-full bg-muted" aria-hidden>
              {span ? (
                <div
                  className={cn("absolute inset-y-0 min-w-1 rounded-full", BAR_TONE[tone])}
                  style={{
                    left: `${((span.start - origin) / total) * 100}%`,
                    width: `${((span.end - span.start) / total) * 100}%`,
                  }}
                />
              ) : null}
            </div>
            <span className="text-sm tabular-nums text-muted-foreground sm:text-right">
              {span ? formatDuration(span.end - span.start) : "not started"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
