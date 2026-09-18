/**
 * What one review reads: the whole pull request, or only the commits added
 * since the last review of it. Every failure here widens to a full review.
 */
import {
  CHECK_RUN_NAME,
  type ChangedFile,
  type GithubInstallationClient,
} from "@pr-review/github";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { reviewCorrelation, type ReviewTarget } from "./review-target.js";

/** The whole pull request, and why it was not narrowed. */
export interface FullReviewScope {
  kind: "full";
  reason: string;
  diff: string;
  changedFiles: readonly ChangedFile[];
}

/** Only the commits since `sinceSha`; `pullRequest` stays the whole diff. */
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

/** The whole pull request, whatever the scope: what publishing anchors against. */
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
  /** False resolves straight to a full review, reading nothing. */
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

/** Commits searched for a baseline before giving up and reviewing it all. */
const MAX_BASELINE_LOOKBACK = 20;

/** A completed run of our own check, whatever it concluded. */
function reviewedHere(runs: readonly { name: string; status: string }[]): boolean {
  return runs.some(
    (run) => run.name === CHECK_RUN_NAME && run.status === "completed",
  );
}

/**
 * The newest commit before the head that our check run has already read.
 * undefined when no earlier commit carries one.
 */
async function findBaseline(
  client: ScopeClient,
  target: ReviewTarget,
): Promise<string | undefined> {
  const shas = await client.listPullRequestCommitShas(target);
  // Newest first, head excluded: the head's own run is this one, if any.
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

/** A unified diff rebuilt from the files it should cover, and nothing else. */
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

/**
 * The files changed since the baseline that this pull request also changed.
 * A base-branch merge brings in files the pull request never touched.
 */
export function intersectWithPullRequest(
  since: readonly ChangedFile[],
  pullRequest: readonly ChangedFile[],
): ChangedFile[] {
  const inPullRequest = new Set(pullRequest.map((file) => file.filename));
  return since.filter((file) => inPullRequest.has(file.filename));
}

/** Never throws: an unreadable baseline is a full review, not a failed one. */
export async function resolveReviewScope(
  target: ReviewTarget,
  deps: ResolveReviewScopeDeps,
): Promise<ReviewScope> {
  const { client, logger, diff, changedFiles } = deps;
  if (!deps.incremental) {
    return full("not enabled", deps);
  }

  let scope: ReviewScope;
  try {
    const sinceSha = await findBaseline(client, target);
    if (sinceSha === undefined) {
      scope = full("no_baseline", deps);
    } else {
      const comparison = await client.compareCommits({
        owner: target.owner,
        repo: target.repo,
        base: sinceSha,
        head: target.headSha,
      });
      if (comparison.status !== "ahead") {
        // A rebase or force-push leaves a baseline describing commits that are gone.
        scope = full("head_rewritten", deps);
      } else {
        const since = intersectWithPullRequest(comparison.files, changedFiles);
        scope = {
          kind: "incremental",
          sinceSha,
          diff: renderDiff(since),
          changedFiles: since,
          pullRequest: { diff, changedFiles },
        };
      }
    }
  } catch (error) {
    logger.error("review.scope_unreadable", {
      ...reviewCorrelation(target),
      reason: errorMessage(error),
      fallback: "reviewing the whole pull request",
    });
    scope = full("baseline_unreadable", deps);
  }

  logger.info("review.scope_resolved", {
    ...reviewCorrelation(target),
    kind: scope.kind,
    pullRequestFileCount: changedFiles.length,
    ...(scope.kind === "incremental"
      ? { sinceSha: scope.sinceSha, incrementalFileCount: scope.changedFiles.length }
      : { reason: scope.reason }),
  });
  return scope;
}
