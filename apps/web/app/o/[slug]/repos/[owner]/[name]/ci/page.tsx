import { Button, Card } from "@pr-review/design";
import { ArrowLeft, X } from "@pr-review/design/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode, Suspense } from "react";

import { WorkflowRunsTable, WorkflowsTable } from "@/components/ci";
import { EmptyNotice, Section } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { StatGridSkeleton, TableCardSkeleton } from "@/components/ui";
import { Stat, StatGrid } from "@/components/ui/stat";
import { CI_CONCLUSIONS, ciFiltersQuery, parseCiFilters, type CiFilters } from "@/lib/ci-filters";
import { data } from "@/lib/data/server";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { installAppUrl } from "@/lib/github-app";
import { organizationPath } from "@/lib/paths";

export const metadata: Metadata = { title: "CI runs" };

const RUN_LIMIT = 50;

type Repo = { id: number; owner: string; name: string };

// Shared by the stats, the workflow table and the filter labels, so all read one query.
const ciTrends = cache(async (slug: string, repoId: number) =>
  (await data(slug)).getCiTrends(repoId),
);

async function CiStats({ slug, repo }: { slug: string; repo: Repo }) {
  const { totals } = await ciTrends(slug, repo.id);
  const slowest = totals.slowestWorkflow;
  return (
    <StatGrid>
      <Stat label="Runs / 30d" value={formatNumber(totals.runs)} />
      <Stat label="Failure rate / 30d" value={formatPercent(totals.failureRate)} />
      <Stat
        label="Median duration / 30d"
        value={totals.medianDurationMs === null ? "—" : formatDuration(totals.medianDurationMs)}
      />
      <Stat
        label={slowest ? `Slowest: ${slowest.workflowName}` : "Slowest workflow"}
        value={slowest ? formatDuration(slowest.p50DurationMs) : "—"}
      />
    </StatGrid>
  );
}


async function Workflows({ slug, repo, ciHref }: { slug: string; repo: Repo; ciHref: string }) {
  const [{ workflows }, source] = await Promise.all([ciTrends(slug, repo.id), data(slug)]);
  if (workflows.length === 0) {
    return (
      <Card className="py-0">
        <EmptyNotice
          title="No workflow runs yet"
          sentence="Runs appear once the App has the Actions (read) permission and a workflow runs. CI insights can be turned off in this repository's settings."
          action={{
            label: "Review App permissions",
            href: installAppUrl(source.organization.githubAccountId),
          }}
        />
      </Card>
    );
  }
  return (
    <Card className="py-0">
      <WorkflowsTable
        ciHref={ciHref}
        workflows={workflows}
        caption={`Each workflow of ${repo.owner}/${repo.name} over the last 30 days, busiest first.`}
      />
    </Card>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Button asChild size="sm" variant={active ? "secondary" : "ghost"}>
      <Link href={href} aria-current={active ? "true" : undefined} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}

async function RunFilters({
  slug,
  repo,
  ciHref,
  filters,
}: {
  slug: string;
  repo: Repo;
  ciHref: string;
  filters: CiFilters;
}) {
  const { workflows } = await ciTrends(slug, repo.id);
  const workflowName =
    filters.workflowId === undefined
      ? undefined
      : (workflows.find((w) => w.workflowId === filters.workflowId)?.workflowName ??
        `workflow ${filters.workflowId}`);
  const { conclusion: _c, ...anyConclusion } = filters;
  const { branch: _b, ...anyBranch } = filters;
  const { workflowId: _w, ...anyWorkflow } = filters;

  return (
    <div role="group" aria-label="Filter runs" className="flex flex-wrap items-center gap-2">
      <FilterLink href={`${ciHref}${ciFiltersQuery(anyConclusion)}`} active={!filters.conclusion}>
        All
      </FilterLink>
      {CI_CONCLUSIONS.map((option) => (
        <FilterLink
          key={option.value}
          href={`${ciHref}${ciFiltersQuery({ ...filters, conclusion: option.value })}`}
          active={filters.conclusion === option.value}
        >
          {option.label}
        </FilterLink>
      ))}
      {workflowName ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`${ciHref}${ciFiltersQuery(anyWorkflow)}`} scroll={false}>
            {workflowName}
            <X aria-label="Remove workflow filter" />
          </Link>
        </Button>
      ) : null}
      {filters.branch ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`${ciHref}${ciFiltersQuery(anyBranch)}`} scroll={false}>
            <span className="max-w-48 truncate font-mono text-xs">{filters.branch}</span>
            <X aria-label="Remove branch filter" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

async function RecentRuns({
  slug,
  repo,
  ciHref,
  filters,
}: {
  slug: string;
  repo: Repo;
  ciHref: string;
  filters: CiFilters;
}) {
  const runs = await (await data(slug)).listWorkflowRuns({
    repoId: repo.id,
    ...filters,
    limit: RUN_LIMIT,
  });
  if (runs.length === 0) {
    return (
      <Card className="py-0">
        <EmptyNotice
          title="No matching runs"
          sentence="No run matches every one of these filters."
          action={{ label: "Clear filters", href: ciHref }}
        />
      </Card>
    );
  }
  return (
    <Card className="py-0">
      <WorkflowRunsTable
        ciHref={ciHref}
        filters={filters}
        runs={runs}
        caption={`Up to ${RUN_LIMIT} runs of ${repo.owner}/${repo.name} matching the filters, newest first.`}
      />
    </Card>
  );
}

async function RunsSection({
  slug,
  repo,
  ciHref,
  filters,
}: {
  slug: string;
  repo: Repo;
  ciHref: string;
  filters: CiFilters;
}) {
  const { totals } = await ciTrends(slug, repo.id);
  if (totals.runs === 0 && ciFiltersQuery(filters) === "") return null;
  return (
    <Section title="Recent runs">
      <div className="flex flex-col gap-4">
        <RunFilters slug={slug} repo={repo} ciHref={ciHref} filters={filters} />
        <Suspense fallback={<TableCardSkeleton rows={10} columns={8} />}>
          <RecentRuns slug={slug} repo={repo} ciHref={ciHref} filters={filters} />
        </Suspense>
      </div>
    </Section>
  );
}

export default async function RepoCiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; owner: string; name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug, owner, name }, query] = await Promise.all([params, searchParams]);
  const repo = await (await data(slug)).getRepo(owner, name);
  if (!repo) notFound();
  const filters = parseCiFilters(query);
  const repoHref = organizationPath(slug, `/repos/${repo.owner}/${repo.name}`);
  const ciHref = `${repoHref}/ci`;

  return (
    <>
      <PageHeader
        eyebrow="CI runs"
        title={
          <span className="font-mono text-[0.85em]">
            <span className="text-muted-foreground">{repo.owner}/</span>
            {repo.name}
          </span>
        }
        description="GitHub Actions runs from the last 30 days. Each rerun is its own attempt."
        actions={
          <Button asChild variant="outline">
            <Link href={repoHref}>
              <ArrowLeft aria-hidden />
              Repository
            </Link>
          </Button>
        }
      />

      <div className="mt-8">
        <Suspense fallback={<StatGridSkeleton count={4} />}>
          <CiStats slug={slug} repo={repo} />
        </Suspense>
      </div>

      <Section title="Workflows">
        <Suspense fallback={<TableCardSkeleton rows={4} columns={6} />}>
          <Workflows slug={slug} repo={repo} ciHref={ciHref} />
        </Suspense>
      </Section>

      <Suspense fallback={null}>
        <RunsSection slug={slug} repo={repo} ciHref={ciHref} filters={filters} />
      </Suspense>
    </>
  );
}
