import { authorize } from "@pr-review/db";
import { createDbSource, type DataSource, type ReviewSummary } from "@pr-review/db/dashboard";

import type { McpEnvironment } from "#src/environment";

export interface Scoped {
  source: DataSource;
  repoId?: number;
}

export function summariseReview(review: ReviewSummary) {
  return {
    id: review.id,
    repo: `${review.repo.owner}/${review.repo.name}`,
    prNumber: review.prNumber,
    headSha: review.headSha.slice(0, 7),
    createdAt: review.createdAt,
    summary: review.summary,
    findingCount: review.findingCount,
    bySeverity: review.bySeverity,
    durationMs: review.durationMs,
    costUsd: Number(review.costUsd.toFixed(4)),
  };
}

/** The dashboard's own access rules, applied to the signed-in GitHub user. */
export async function scopeToOrganization(
  environment: McpEnvironment,
  githubId: () => Promise<number>,
  org: string,
  repo: string | undefined,
): Promise<Scoped> {
  const database = environment.database();
  const [owner, name] = repo?.split("/") ?? [];
  const repoRef = owner && name ? { owner, name } : undefined;
  const session = { githubId: await githubId() };
  let access = await authorize(database, session, org, repoRef);
  if (access.status === "redirect") {
    access = await authorize(database, session, access.slug, repoRef);
  }
  if (access.status !== "allowed") {
    throw new Error(
      repoRef
        ? `No readable repository ${repo} in organization "${org}" for your GitHub account.`
        : `No organization "${org}" that your GitHub account is a member of.`,
    );
  }
  return {
    source: createDbSource(database, access.organization, access.readableRepos.map((entry) => entry.id)),
    ...(access.repo ? { repoId: access.repo.id } : {}),
  };
}

/** One stored review with every finding, or a throw if it is not readable. */
export async function readStoredReview(
  environment: McpEnvironment,
  githubId: () => Promise<number>,
  org: string,
  id: number,
) {
  const { source } = await scopeToOrganization(environment, githubId, org, undefined);
  const review = await source.getReview(id);
  if (review === null) {
    throw new Error(`No review ${id} in organization "${org}" that your GitHub account can read.`);
  }
  return {
    ...summariseReview(review),
    findings: review.findings.map(({ id: _id, reviewId: _reviewId, ...finding }) => finding),
  };
}
