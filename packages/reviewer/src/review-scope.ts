/** Whole PR or only the commits since the last review; failures widen to whole. */
import {
  CHECK_RUN_NAME,
  type ChangedFile,
  type GithubInstallationClient,
} from "@pr-review/github";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { reviewCorrelation, type ReviewTarget } from "./review-target.js";

export interface FullReviewScope {
  kind: "full";
  reason: string;
  diff: string;
  changedFiles: readonly ChangedFile[];
}

/** `pullRequest` keeps the whole diff beside the narrowed one. */
export interface IncrementalReviewScope {
  kind: "incremental";
  sinceSha: string;
  diff: string;
  changedFiles: readonly ChangedFile[];
  pullRequest: {
    diff: string;
    changedFiles: readonly ChangedFile[];
  };
}

export type ReviewScope = FullReviewScope | IncrementalReviewScope;

export function wholePullRequest(scope: ReviewScope): {
  diff: string;
  changedFiles: readonly ChangedFile[];
} {
  return scope.kind === "incremental"
    ? scope.pullRequest
    : { diff: scope.diff, changedFiles: scope.changedFiles };
}

type ScopeClient = Pick<
  GithubInstallationClient,
  "listPullRequestCommitShas" | "listCheckRuns" | "compareCommits"
>;

export interface ResolveReviewScopeDeps {
  client: ScopeClient;
  incremental: boolean;
  diff: string;
  changedFiles: readonly ChangedFile[];
  logger: StructuredLogger;
}

function full(
  reason: string,
  deps: Pick<ResolveReviewScopeDeps, "diff" | "changedFiles">,
): FullReviewScope {
  return {
    kind: "full",
    reason,
    diff: deps.diff,
    changedFiles: deps.changedFiles,
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

export function renderDiff(files: readonly ChangedFile[]): string {
  return files
    .filter((file) => file.patch !== undefined)
    .map((file) =>
      [
        `diff --git a/${file.filename} b/${file.filename}`,
        `--- a/${file.filename}`,
        `+++ b/${file.filename}`,
        file.patch,
      ].join("\n"),
    )
    .join("\n");
}

// Drops files that only changed because the base branch was merged in.
export function intersectWithPullRequest(
  since: readonly ChangedFile[],
  pullRequest: readonly ChangedFile[],
): ChangedFile[] {
  const inPullRequest = new Set(pullRequest.map((file) => file.filename));
  return since.filter((file) => inPullRequest.has(file.filename));
}

/** Never throws: an unreadable baseline is a full review, not a failed one. */
async function narrow(
  target: ReviewTarget,
  deps: ResolveReviewScopeDeps,
): Promise<ReviewScope> {
  const { client, diff, changedFiles } = deps;
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
    diff: renderDiff(since),
    changedFiles: since,
    pullRequest: { diff, changedFiles },
  };
}

export async function resolveReviewScope(
  target: ReviewTarget,
  deps: ResolveReviewScopeDeps,
): Promise<ReviewScope> {
  if (!deps.incremental) {
    return full("not enabled", deps);
  }

  let scope: ReviewScope;
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
