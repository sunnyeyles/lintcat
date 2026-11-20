import { Button, Card } from "@pr-review/design";
import { ArrowLeft } from "@pr-review/design/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ConclusionBadge, JobTimeline } from "@/components/ci";
import { Section } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { Stat, StatGrid } from "@/components/ui/stat";
import { data } from "@/lib/data/server";
import { formatDuration, formatNumber, formatRelative, shortSha } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

type PageProps = { params: Promise<{ slug: string; owner: string; name: string; runId: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1 ? id : null;
}

// The run must sit in the repo the URL names, so a valid id under another path is a 404.
const loadRun = cache(async (slug: string, owner: string, name: string, runId: string) => {
  const id = parseId(runId);
  if (id === null) return null;
  const run = await (await data(slug)).getWorkflowRun(id);
  return run && run.repo.owner === owner && run.repo.name === name ? run : null;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, owner, name, runId } = await params;
  const run = await loadRun(slug, owner, name, runId);
  return { title: run ? `${run.workflowName} · ${owner}/${name}` : "Run not found" };
}

export default async function WorkflowRunPage({ params }: PageProps) {
  const { slug, owner, name, runId } = await params;
  const run = await loadRun(slug, owner, name, runId);
  if (!run) notFound();
  const ciHref = organizationPath(slug, `/repos/${run.repo.owner}/${run.repo.name}/ci`);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Workflow run"
        size="record"
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {run.workflowName}
            <ConclusionBadge status={run.status} conclusion={run.conclusion} />
          </span>
        }
        description={
          <>
            <span className="font-mono">{run.headBranch ?? "no branch"}</span> ·{" "}
            <code className="rounded-sm border border-border bg-muted px-1 py-0.5 text-foreground">
              {shortSha(run.headSha)}
            </code>{" "}
            · {run.event.replace(/_/g, " ")}
            {run.prNumber === null ? null : ` #${run.prNumber}`} · started{" "}
            <time dateTime={run.runStartedAt.toISOString()}>
              {formatRelative(run.runStartedAt)}
            </time>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={ciHref}>
                <ArrowLeft aria-hidden />
                CI runs
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href={run.htmlUrl} target="_blank" rel="noopener noreferrer">
                Open on GitHub ↗
              </a>
            </Button>
          </>
        }
      />

      <StatGrid>
        <Stat
          label="Duration"
          value={run.durationMs === null ? "—" : formatDuration(run.durationMs)}
        />
        <Stat label="Jobs" value={formatNumber(run.jobs.length)} />
        <Stat label="Attempt" value={formatNumber(run.runAttempt)} />
        <Stat label="Status" value={run.status.replace(/_/g, " ")} />
      </StatGrid>

      <Section title="Jobs" className="mt-0">
        <Card className="py-0">
          {run.jobs.length > 0 ? (
            <JobTimeline jobs={run.jobs} />
          ) : (
            <p className="text-muted-foreground px-4 py-6 text-sm">
              No job events have arrived for this run yet.
            </p>
          )}
        </Card>
      </Section>
    </div>
  );
}
