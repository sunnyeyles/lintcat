/**
 * One review, end to end. The side-effect boundary is enforced here, once,
 * rather than in each delivery-path wrapper.
 */
import {
  isCancellation,
  ReviewCancelledError,
  withRepositoryHints,
  type AgentDefinition,
} from "@pr-review/ai";
import type {
  ChangedFile,
  ExistingReviewComment,
  PullRequestReadClient,
} from "@pr-review/github";
import {
  snapshotRepositoryIndex,
  type RepositoryGraphSnapshot,
} from "@pr-review/index";
import {
  createConsoleLogger,
  errorMessage,
  type StructuredLogger,
} from "@pr-review/logging";
import type { ReviewFinding, ReviewMemory } from "@pr-review/schemas";

import { assessBlastRadius } from "#src/blast-radius";
import { buildReviewIndex } from "#src/build-index";
import type { ReviewClient, RunReviewPipeline } from "#src/pipeline-runner";
import { buildDiffLineIndex } from "#src/diff-lines";
import { countLabel } from "#src/finding-format";
import { deliverReview, type PublishReview } from "#src/publish-review";
import type { ReviewDelivery } from "#src/review-delivery";
import {
  computeHints,
  emptyMemory,
  partitionSuppressed,
  readMemory,
  type MemoryStore,
} from "#src/memory";
import { renderCheckRun } from "#src/render-check-run";
import { verifyPatches, type PatchSummary } from "#src/validate-patches";
import {
  findingKey,
  parsePostedFinding,
  postedFindingKeys,
  type PostedFinding,
} from "#src/render-review";
import type { ReviewPipelineResult } from "#src/review-pipeline";
import { reviewCorrelation, type ReviewTarget } from "#src/review-target";
import { resolveReviewScope, wholePullRequest } from "#src/review-scope";
import { suggestReviewers } from "#src/suggest-reviewers";

/** What one review needs once its delivery has already been chosen. */
export interface ReviewWithDeliveryDeps {
  /** Reads only; every write this review makes goes through `delivery`. */
  client: ReviewClient;
  agent: AgentDefinition;
  /** Throws when the agent fails. */
  runReviewPipeline: RunReviewPipeline;
  /** The only route to a publisher: there is no default, and no live fallback. */
  delivery: ReviewDelivery;
  /** Every event carries repository, PR number, and head SHA. */
  logger?: StructuredLogger | undefined;
  /** Where this repository's review memory lives; undefined means no hints. */
  memoryStore?: MemoryStore | undefined;
  /** Injectable clock, so a test can pin what counts as a fresh signal. */
  now?: (() => Date) | undefined;
  incremental?: boolean | undefined;
  /** Whether the repository index is built for this review; on by default. */
  index?: boolean | undefined;
  /** Whether the check run suggests reviewers; on by default. */
  suggestReviewers?: boolean | undefined;
  /** Aborting it stops the agents and publishes nothing. */
  signal?: AbortSignal | undefined;
}

/** The comments already on the pull request; none if they cannot be read. */
async function listPostedComments(
  client: PullRequestReadClient,
  target: ReviewTarget,
  logger: StructuredLogger,
): Promise<ExistingReviewComment[]> {
  try {
    return await client.listReviewComments(target);
  } catch (error) {
    logger.error("review.comments.list_failed", {
      ...reviewCorrelation(target),
      reason: errorMessage(error),
      fallback: "publishing every finding, which may repeat an earlier one",
    });
    return [];
  }
}

async function openEarlierFindings(
  client: PullRequestReadClient,
  target: ReviewTarget,
  logger: StructuredLogger,
): Promise<PostedFinding[]> {
  try {
    const threads = await client.listReviewThreads(target);
    return threads
      .filter((thread) => !thread.isResolved && !thread.isOutdated)
      .flatMap((thread) => parsePostedFinding(thread.body) ?? []);
  } catch (error) {
    logger.error("review.carried_forward.unreadable", {
      ...reviewCorrelation(target),
      reason: errorMessage(error),
      fallback: "publishing only this run's findings",
    });
    return [];
  }
}

/** One memory read serves both readers: the agent's hints and suppressions. */
interface HintedRun {
  agent: AgentDefinition;
  memory: ReviewMemory;
}

/** The run's hints; unhinted when there is no store or the read fails. */
async function attachRepositoryHints(
  agent: AgentDefinition,
  store: MemoryStore | undefined,
  target: ReviewTarget,
  logger: StructuredLogger,
  now: Date,
): Promise<HintedRun> {
  const unhinted: HintedRun = { agent, memory: emptyMemory() };
  if (store === undefined) {
    return unhinted;
  }

  let memory = emptyMemory();
  try {
    memory = await readMemory(store, logger);
  } catch (error) {
    logger.error("memory.read_failed", {
      ...reviewCorrelation(target),
      reason: errorMessage(error),
      fallback: "reviewing without repository hints",
    });
    return unhinted;
  }

  const hints = computeHints(memory, now);
  logger.info("memory.hints_attached", {
    ...reviewCorrelation(target),
    hintCount: hints.length,
  });
  return { agent: withRepositoryHints(agent, hints), memory };
}

function stillOpen(
  carriedForward: readonly PostedFinding[],
  findings: readonly ReviewFinding[],
): PostedFinding[] {
  const reported = new Set(findings.map(findingKey));
  return carriedForward.filter((posted) => !reported.has(posted.key));
}

function incrementalNote(sinceSha: string, fileCount: number): string {
  return `> **Note:** This review read the ${countLabel(fileCount, "file")} changed since \`${sinceSha.slice(0, 7)}\`; earlier commits were reviewed then.`;
}

function noNewChangesNote(sinceSha: string): string {
  return `> **Note:** No file this pull request changed has moved since \`${sinceSha.slice(0, 7)}\`, so nothing was reviewed.`;
}

/** What the review read: the commit it was indexed at and the files it covered. */
interface ReviewedTree {
  /** The pull request's base commit, whatever the index did. */
  baseSha: string;
  /** Every file the pull request changed, not just an incremental scope. */
  changedFiles: readonly ChangedFile[];
  /** The index, serialised; absent when the index was off or failed. */
  graph?: RepositoryGraphSnapshot | undefined;
}

/** One review's outcome, plus how the patches its agents proposed fared. */
export interface ReviewOutcome extends ReviewPipelineResult, ReviewedTree {
  patches: PatchSummary;
  /** Validated findings the memory's suppressions hid from this review. */
  suppressed: number;
}

/** The result of a review that never reached the pipeline. */
function unreviewed(tree: ReviewedTree): ReviewOutcome {
  return {
    candidates: [],
    findings: [],
    patches: { proposed: 0, verified: 0 },
    suppressed: 0,
    ...tree,
  };
}

/**
 * One review against a delivery that was already chosen. Throws when the
 * pipeline or the publish step fails; retries are the caller's.
 */
export async function reviewWithDelivery(
  target: ReviewTarget,
  {
    client,
    agent,
    runReviewPipeline,
    delivery,
    logger = createConsoleLogger(),
    memoryStore,
    now = () => new Date(),
    incremental = false,
    index = true,
    suggestReviewers: suggesting = true,
    signal,
  }: ReviewWithDeliveryDeps,
): Promise<ReviewOutcome> {
  const fields = reviewCorrelation(target);
  const cancelled = (stage: string): never => {
    logger.info("review.cancelled", { ...fields, stage });
    throw new ReviewCancelledError();
  };
  if (signal?.aborted === true) {
    cancelled("before start");
  }
  const [pullRequest, changedFiles, diff] = await Promise.all([
    client.getPullRequest(target),
    client.listChangedFiles(target),
    client.getDiff(target),
  ]);
  logger.info("review.loaded", {
    ...fields,
    changedFileCount: changedFiles.length,
    diffLength: diff.length,
  });
  const tree: ReviewedTree = { baseSha: pullRequest.baseSha, changedFiles };

  const scope = await resolveReviewScope(target, {
    client,
    incremental,
    diff,
    changedFiles,
    logger,
  });
  const whole = wholePullRequest(scope);
  // The early returns below publish too, so the guard sits on the publisher.
  const publish: PublishReview = async (reviewed, rendered) => {
    if (signal?.aborted === true) {
      cancelled("before publish");
    }
    await delivery.publishCheckRun(reviewed, rendered);
  };
  // The agent sees the scope; publishing sees the whole PR, so comments anchor anywhere.
  const carriedForward =
    scope.kind === "incremental"
      ? await openEarlierFindings(client, target, logger)
      : [];

  if (scope.kind === "incremental" && scope.changedFiles.length === 0) {
    logger.info("review.incremental.no_changes", {
      ...fields,
      sinceSha: scope.sinceSha,
      carriedForwardCount: carriedForward.length,
    });
    await publish(
      target,
      renderCheckRun([], {
        annotate: false,
        carriedForward,
        scopeNote: noNewChangesNote(scope.sinceSha),
      }),
    );
    return unreviewed(tree);
  }

  const { agent: hinted, memory } = await attachRepositoryHints(
    agent,
    memoryStore,
    target,
    logger,
    now(),
  );

  // Built once, before the agent starts, and serialised onto the outcome.
  const { index: repositoryIndex, codeowners } = await buildReviewIndex({
    client,
    target,
    baseSha: pullRequest.baseSha,
    enabled: index,
    logger,
  });
  const blastRadius = assessBlastRadius({
    index: repositoryIndex,
    changedFiles,
    target,
    logger,
  });

  // The AI boundary: only the validate step's output reaches GitHub.
  const [review, suggestedReviewers] = await Promise.all([
    runReviewPipeline({
      client,
      context: {
        owner: target.owner,
        repo: target.repo,
        pullRequest,
        changedFiles: scope.changedFiles,
        diff: scope.diff,
        incremental:
          scope.kind === "incremental"
            ? { sinceSha: scope.sinceSha, ...scope.pullRequest }
            : undefined,
        signal,
      },
      agent: hinted,
      index: repositoryIndex,
    }).catch((error: unknown) => {
      if (isCancellation(error, signal)) {
        cancelled("agent");
      }
      throw error;
    }),
    // Beside the agent, so blame adds no wait of its own.
    suggestReviewers({
      client,
      target,
      baseSha: pullRequest.baseSha,
      author: pullRequest.author,
      changedFiles,
      codeowners,
      enabled: suggesting,
      now: now(),
      logger,
    }),
  ]);

  logger.info("findings.validated", {
    ...fields,
    candidateCount: review.candidates.length,
    findingCount: review.findings.length,
  });

  const { kept, suppressed } = partitionSuppressed(memory, review.findings);
  if (suppressed.length > 0) {
    logger.info("findings.suppressed", {
      ...fields,
      suppressedCount: suppressed.length,
      titles: suppressed.map((finding) => finding.title),
    });
  }

  // Still inside the AI boundary: a patch is proved against the head commit
  // before any of it can be committed or offered.
  const verified = await verifyPatches(kept, whole.changedFiles, {
    client,
    owner: target.owner,
    repo: target.repo,
    headSha: target.headSha,
  });
  logger.info("patches.verified", {
    ...fields,
    proposedCount: verified.summary.proposed,
    verifiedCount: verified.summary.verified,
    files: verified.files.map((file) => file.path),
  });

  if (signal?.aborted === true) {
    cancelled("before publish");
  }

  await deliverReview(
    target,
    {
      findings: verified.findings,
      diffLines: buildDiffLineIndex(whole.changedFiles),
      patches: {
        branch: pullRequest.headRef,
        files: verified.files,
        patchCount: verified.patchCount,
      },
      alreadyPosted: postedFindingKeys(
        await listPostedComments(client, target, logger),
      ),
      carriedForward: stillOpen(carriedForward, verified.findings),
      scopeNote:
        scope.kind === "incremental"
          ? incrementalNote(scope.sinceSha, scope.changedFiles.length)
          : undefined,
      blastRadius,
      suggestedReviewers,
    },
    {
      publishCheckRun: publish,
      publishComments: delivery.publishComments,
      ...(delivery.publishFixes === undefined
        ? {}
        : { publishFixes: delivery.publishFixes }),
      logger,
    },
  );

  return {
    ...review,
    findings: verified.findings,
    patches: verified.summary,
    suppressed: suppressed.length,
    ...tree,
    ...(repositoryIndex === undefined
      ? {}
      : { graph: snapshotRepositoryIndex(repositoryIndex) }),
  };
}
