import {
  Card,
  Chip,
  cn,
  EmptyState,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import { notFound } from "next/navigation";

import { AgentChips, RowLink, Section, SeverityMix, Sparkline } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { data, type ReviewSummary } from "@/lib/data";
import {
  formatDuration,
  formatNumber,
  formatRelative,
  formatUsd,
  shortSha,
} from "@/lib/format";

type PrGroup = { prNumber: number; reviews: ReviewSummary[] };

// Input is newest-first, so insertion order already ranks groups by latest review.
function groupByPr(reviews: ReviewSummary[]): PrGroup[] {
  const byPr = new Map<number, ReviewSummary[]>();
  for (const review of reviews) {
    const existing = byPr.get(review.prNumber);
    if (existing) existing.push(review);
    else byPr.set(review.prNumber, [review]);
  }
  return [...byPr].map(([prNumber, rows]) => ({ prNumber, reviews: rows }));
}

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;
  const source = data();
  const repo = await source.getRepo(owner, name);
  if (!repo) notFound();

  const [reviews, trends, usage] = await Promise.all([
    source.listReviews({ repoId: repo.id }),
    source.getTrends("30d", repo.id),
    source.getUsage("30d", repo.id),
  ]);

  const groups = groupByPr(reviews);
  const revisited = groups.filter((group) => group.reviews.length > 1).length;

  return (
    <>
      <PageHeader
        eyebrow="Repository"
        title={
          <span className="font-mono text-[0.85em]">
            <span className="text-slate">{repo.owner}/</span>
            {repo.name}
          </span>
        }
        description={`${formatNumber(repo.reviewCount)} reviews across ${formatNumber(groups.length)} pull requests · last reviewed ${
          repo.lastReviewedAt ? formatRelative(repo.lastReviewedAt) : "never"
        }`}
      />

      <StatGrid className="mt-8">
        <Stat label="Reviews / 30d" value={formatNumber(trends.totals.reviews)}>
          <Sparkline
            points={trends.points}
            label={`Daily review volume for ${repo.owner}/${repo.name} over the last 30 days`}
          />
        </Stat>
        <Stat
          label="Reviews all time"
          value={formatNumber(repo.reviewCount)}
          hint={revisited > 0 ? `${formatNumber(revisited)} PRs reviewed more than once` : undefined}
        />
        <Stat label="Findings all time" value={formatNumber(repo.findingCount)} />
        <Stat
          label="High severity"
          value={formatNumber(repo.openHighSeverity)}
          delta={{
            value: repo.openHighSeverity > 0 ? "needs attention" : "clear",
            tone: repo.openHighSeverity > 0 ? "stop" : "ok",
          }}
        />
        <Stat
          label="Median duration"
          value={formatDuration(trends.totals.medianDurationMs)}
          hint="last 30 days"
        />
        <Stat
          label="Spend / 30d"
          value={formatUsd(usage.totals.costUsd)}
          hint={`${formatUsd(repo.costUsd)} all time`}
        />
      </StatGrid>

      <Section
        title="Review history"
        action={
          revisited > 0 ? (
            <span className="font-mono text-caption text-slate">
              Grouped by pull request
            </span>
          ) : undefined
        }
      >
        <Card padding="table">
          {reviews.length > 0 ? (
            <Table className="min-w-[40rem]">
              <TableCaption className="sr-only">
                Every review of {repo.owner}/{repo.name}, grouped by pull request, newest
                first.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Pull request</TableHead>
                  <TableHead scope="col">Head</TableHead>
                  <TableHead scope="col">Agents</TableHead>
                  <TableHead scope="col">Findings</TableHead>
                  <TableHead scope="col" className="text-right">
                    Duration
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    When
                  </TableHead>
                </TableRow>
              </TableHeader>
              {groups.map((group) => {
                const total = group.reviews.length;
                const grouped = total > 1;
                return (
                  <TableBody
                    key={group.prNumber}
                    className={cn(grouped && "border-b border-rule last:border-b-0")}
                  >
                    {grouped ? (
                      <tr>
                        <th
                          scope="rowgroup"
                          colSpan={6}
                          className="pt-4 pb-1.5 text-left font-mono text-label font-medium text-ink"
                        >
                          PR #{group.prNumber}{" "}
                          <Chip variant="soft" className="ml-1.5">
                            {total} reviews
                          </Chip>
                        </th>
                      </tr>
                    ) : null}
                    {group.reviews.map((review, index) => {
                      const revision = total - index;
                      return (
                        <TableRow key={review.id} className="group relative">
                          <TableCell
                            className={cn(
                              "whitespace-nowrap",
                              grouped && "border-l-2 border-accent/30 pl-3",
                            )}
                          >
                            <RowLink
                              href={`/reviews/${review.id}`}
                              aria-label={
                                grouped
                                  ? `Review ${revision} of ${total} for pull request ${group.prNumber}`
                                  : `Review of pull request ${group.prNumber}`
                              }
                            >
                              {grouped ? `rev ${revision}` : `#${group.prNumber}`}
                            </RowLink>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <code className="rounded-xs border border-rule-soft bg-surface-2 px-1 py-0.5 text-label">
                              {shortSha(review.headSha)}
                            </code>
                          </TableCell>
                          <TableCell>
                            <AgentChips agents={review.agents} max={2} />
                          </TableCell>
                          <TableCell>
                            <SeverityMix bySeverity={review.bySeverity} />
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
                      );
                    })}
                  </TableBody>
                );
              })}
            </Table>
          ) : (
            <EmptyState
              title="No reviews for this repository"
              description="The agents have not published a review here yet."
            />
          )}
        </Card>
      </Section>
    </>
  );
}
