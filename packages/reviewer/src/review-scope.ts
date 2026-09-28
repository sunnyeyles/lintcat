/** Every failure here widens to a full review; none fails one. */
import type { ReviewScope } from "@pr-review/ai";
import {
  CHECK_RUN_NAME,
  type ChangedFile,
  type PullRequestReadClient,
  type RepositoryHistoryClient,
} from "@pr-review/github";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { reviewCorrelation, type ReviewTarget } from "#src/review-target";

type FullReviewScope = ReviewScope & { kind: "full"; reason: string; sinceSha?: undefined };

type IncrementalReviewScope = ReviewScope & { kind: "incremental"; sinceSha: string };

type ResolvedReviewScope = FullReviewScope | IncrementalReviewScope;

/** `compareCommits` is optional: an adapter without it can only review the whole pull request. */
type ScopeClient = Pick<RepositoryHistoryClient, "listPullRequestCommitShas"> &
  Partial<Pick<RepositoryHistoryClient, "compareCommits">> &
  Pick<PullRequestReadClient, "listCheckRuns">;

export interface ResolveReviewScopeDeps {
  client: ScopeClient;
  incremental: boolean;
  changedFiles: readonly ChangedFile[];
  logger: StructuredLogger;
}

function full(
  reason: string,
  deps: Pick<ResolveReviewScopeDeps, "changedFiles">,
): FullReviewScope {
  return {
    kind: "full",
    reason,
    changedFiles: deps.changedFiles,
    pullRequestFiles: deps.changedFiles,
  };
}

const MAX_BASELINE_LOOKBACK = 20;

function reviewedHere(runs: readonly { name: string; status: string }[]): boolean {
  return runs.some(
    (run) => run.name === CHECK_RUN_NAME && run.status === "completed",
  );
}

async function findBaseline(
  client: ScopeClient,
  target: ReviewTarget,
): Promise<string | undefined> {
  const shas = await client.listPullRequestCommitShas(target);
  // The head's own check run belongs to this review, so skip it.
  const earlier = shas
    .filter((sha) => sha !== target.headSha)
    .reverse()
    .slice(0, MAX_BASELINE_LOOKBACK);
  for (const sha of earlier) {
    const runs = await client.listCheckRuns({
      owner: target.owner,
      repo: target.repo,
      sha,
    });
    if (reviewedHere(runs)) {
      return sha;
    }
  }
  return undefined;
}

// Drops files that only changed because the base branch was merged in.
export function intersectWithPullRequest(
  since: readonly ChangedFile[],
  pullRequest: readonly ChangedFile[],
): ChangedFile[] {
  const inPullRequest = new Set(pullRequest.map((file) => file.filename));
  return since.filter((file) => inPullRequest.has(file.filename));
}

async function narrow(
  target: ReviewTarget,
  deps: ResolveReviewScopeDeps,
): Promise<ResolvedReviewScope> {
  const { client, changedFiles } = deps;
  if (client.compareCommits === undefined) {
    return full("no_commit_comparison", deps);
  }
  const sinceSha = await findBaseline(client, target);
  if (sinceSha === undefined) {
    return full("no_baseline", deps);
  }

  const comparison = await client.compareCommits({
    owner: target.owner,
    repo: target.repo,
    base: sinceSha,
    head: target.headSha,
  });
  // A rebase or force-push leaves a baseline whose commits are gone.
  if (comparison.status !== "ahead") {
    return full("head_rewritten", deps);
  }

  const since = intersectWithPullRequest(comparison.files, changedFiles);
  return {
    kind: "incremental",
    sinceSha,
    changedFiles: since,
    pullRequestFiles: changedFiles,
  };
}

export async function resolveReviewScope(
  target: ReviewTarget,
  deps: ResolveReviewScopeDeps,
): Promise<ResolvedReviewScope> {
  if (!deps.incremental) {
    return full("not enabled", deps);
  }

  let scope: ResolvedReviewScope;
  try {
    scope = await narrow(target, deps);
  } catch (error) {
    deps.logger.error("review.scope_unreadable", {
      ...reviewCorrelation(target),
      reason: errorMessage(error),
      fallback: "reviewing the whole pull request",
    });
    scope = full("baseline_unreadable", deps);
  }

  deps.logger.info("review.scope_resolved", {
    ...reviewCorrelation(target),
    kind: scope.kind,
    pullRequestFileCount: deps.changedFiles.length,
    ...(scope.kind === "incremental"
      ? { sinceSha: scope.sinceSha, incrementalFileCount: scope.changedFiles.length }
      : { reason: scope.reason }),
  });
  return scope;
}
