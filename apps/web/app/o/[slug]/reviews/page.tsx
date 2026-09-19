import {
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import { GitPullRequest } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SEVERITIES } from "@/components/review";
import { PageHeader } from "@/components/shell";
import { AgentChip, SeverityBadge } from "@/components/ui";
import { data } from "@/lib/data/server";
import { formatDuration, formatRelative, formatUsd, shortSha } from "@/lib/format";
import { organizationPath } from "@/lib/paths";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const reviews = await (await data(slug)).listReviews({ limit: 50 });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Reviews"
        title="Recent reviews"
        description={`The last ${reviews.length} runs across every repository, newest first. Open one to read what the agents found.`}
      />

      {reviews.length === 0 ? (
        <EmptyState
          icon={<GitPullRequest />}
          title="No reviews yet"
          description="Once a pull request event reaches the pipeline, its review lands here."
        />
      ) : (
        <Card padding="table">
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Pull request</TableHead>
                <TableHead>Head</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead className="w-[6rem]">Duration</TableHead>
                <TableHead className="w-[5.5rem]">Cost</TableHead>
                <TableHead className="w-[6rem]">Ran</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>
                    <Link
                      href={organizationPath(slug, `/reviews/${review.id}`)}
                      className="text-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      {review.repo.owner}/{review.repo.name} #{review.prNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate">
                    {shortSha(review.headSha)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {review.agents.map((agent) => (
                        <AgentChip key={agent} agent={agent} />
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    {review.findingCount === 0 ? (
                      <span className="text-ok">clean</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {SEVERITIES.filter((s) => review.bySeverity[s] > 0).map((s) => (
                          <SeverityBadge key={s} severity={s} count={review.bySeverity[s]} />
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDuration(review.durationMs)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatUsd(review.costUsd)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <time dateTime={review.createdAt.toISOString()}>
                      {formatRelative(review.createdAt)}
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
