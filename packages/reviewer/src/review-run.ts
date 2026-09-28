// One review run, end to end: load, scope, memory, index, agent, validation,
// patch verification and delivery. Cancellation is decided here.
import {
  addTokenUsage,
  emptyTokenUsage,
  GENERAL_AGENT,
  isCancellation,
  ReviewCancelledError,
  withRepositoryHints,
  type AgentDefinition,
  type ReviewEngine,
} from "@pr-review/ai";
import type {
  ChangedFile,
  ExistingReviewComment,
  PullRequestReadClient,
  RepositoryHistoryClient,
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
import type {
  ReviewFinding,
  ReviewMemory as MemoryContents,
} from "@pr-review/schemas";

import { assessBlastRadius, type BlastRadius } from "#src/blast-radius";
import { buildReviewIndex } from "#src/build-index";
import { buildDiffLineIndex } from "#src/diff-lines";
import { countLabel } from "#src/finding-format";
import {
  computeHints,
  emptyMemory,
  partitionSuppressed,
  readMemory,
  type MemoryStore,
} from "#src/memory";
import { deliverReview } from "#src/publish-review";
import { renderCheckRun } from "#src/render-check-run";
import {
  findingKey,
  parsePostedFinding,
  postedFindingKeys,
  type PostedFinding,
} from "#src/render-review";
import type { FinishedReviewRun, ReviewDelivery } from "#src/review-delivery";
import { resolveReviewScope } from "#src/review-scope";
import { reviewCorrelation, type ReviewTarget } from "#src/review-target";
import { suggestReviewers } from "#src/suggest-reviewers";
import { validateFindings } from "#src/validate-findings";
import { verifyPatches, type PatchSummary } from "#src/validate-patches";

/** What one review reads. The optional methods are absent on an adapter with no commit graph. */
export type ReviewClient = PullRequestReadClient &
  Pick<RepositoryHistoryClient, "listCommitShas" | "listPullRequestCommitShas"> &
  Partial<
    Pick<RepositoryHistoryClient, "listCommitFiles" | "compareCommits" | "blame">
  >;

/** What the run does, as opposed to what it reads or where it writes. */
export interface ReviewPolicy {
  /** Review only the commits since this pull request's last review. */
  incremental?: boolean | undefined;
  /** Build the repository index for this run; on unless switched off. */
  index?: boolean | undefined;
  /** Suggest reviewers on the check run; on unless switched off. */
  suggestReviewers?: boolean | undefined;
}

/** Repository memory, with the clock that decides what counts as fresh. */
export interface ReviewMemory {
  store: MemoryStore;
  /** Defaults to the wall clock; a test pins it. */
  now?: (() => Date) | undefined;
}

export interface ReviewRunSpec {
  /** Reads only: every write this run makes goes through `delivery`. */
  client: ReviewClient;
  target: ReviewTarget;
  delivery: ReviewDelivery;
  engine: ReviewEngine;
  policy?: ReviewPolicy | undefined;
  /** Omitted, the run reads no memory and attaches no hints. */
  memory?: ReviewMemory | undefined;
  logger?: StructuredLogger | undefined;
  /** Aborting it stops the agent and publishes nothing. */
  signal?: AbortSignal | undefined;
  /** Asked before each write to the pull request; false cancels the run. */
  stillRunning?: (() => Promise<boolean>) | undefined;
}

/** What the review read: the commit it was indexed at and the files it covered. */
interface ReviewedTree {
  /** The pull request's base commit, whatever the index did. */
  baseSha: string;
  /** Every file the pull request changed, not just an incremental scope. */
  changedFiles: readonly ChangedFile[];
  /** The index, serialised; absent when the index was off or failed. */
  graph?: RepositoryGraphSnapshot | undefined;
  /** Absent when the index was off or failed, or scoring failed. */
  blastRadius?: BlastRadius | undefined;
}

/** One review's outcome, plus how the patches its agent proposed fared. */
export interface ReviewOutcome extends ReviewedTree {
  /** Untrusted candidate findings the agent proposed. */
  candidates: unknown[];
  /** The validated, verified findings that were published. */
  findings: ReviewFinding[];
  patches: PatchSummary;
  /** Validated findings the memory's suppressions hid from this review. */
  suppressed: number;
}

/** The one place the run decides it was cancelled. */
function cancellation(
  signal: AbortSignal | undefined,
  stillRunning: (() => Promise<boolean>) | undefined,
  logger: StructuredLogger,
  fields: Record<string, unknown>,
) {
  const cancel = (stage: string): never => {
    logger.info("review.cancelled", { ...fields, stage });
    throw new ReviewCancelledError();
  };
  return {
    check(stage: string): void {
      if (signal?.aborted === true) cancel(stage);
    },
    async beforeWrite(): Promise<void> {
      if (signal?.aborted === true) cancel("before publish");
      if (stillRunning !== undefined && !(await stillRunning())) {
        cancel("before publish");
      }
    },
    fromError(error: unknown, stage: string): never {
      if (isCancellation(error, signal)) cancel(stage);
      throw error;
    },
  };
}

/** The delivery with every write to the pull request behind the cancellation check. */
function guarded(
  delivery: ReviewDelivery,
  beforeWrite: () => Promise<void>,
): ReviewDelivery {
  const { publishFixes } = delivery;
  return {
    publishCheckRun: async (target, rendered) => {
      await beforeWrite();
      await delivery.publishCheckRun(target, rendered);
    },
    publishComments: async (target, rendered) => {
      await beforeWrite();
      return delivery.publishComments(target, rendered);
    },
    ...(publishFixes === undefined
      ? {}
      : {
          publishFixes: async (target, input) => {
            await beforeWrite();
            return publishFixes(target, input);
          },
        }),
  };
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
  memory: MemoryContents;
}

/** The run's hints; unhinted when there is no store, and `readMemory` never throws. */
async function attachRepositoryHints(
  agent: AgentDefinition,
  store: MemoryStore | undefined,
  target: ReviewTarget,
  logger: StructuredLogger,
  now: Date,
): Promise<HintedRun> {
  if (store === undefined) {
    return { agent, memory: emptyMemory() };
  }

  const memory = await readMemory(store, logger);

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

/** The result of a review that never reached the agent. */
function unreviewed(tree: ReviewedTree): ReviewOutcome {
  return {
    candidates: [],
    findings: [],
    patches: { proposed: 0, verified: 0 },
    suppressed: 0,
    ...tree,
  };
}

/** Runs one review. Throws when the agent or a publish step fails; retries are the caller's. */
export async function runReview(spec: ReviewRunSpec): Promise<FinishedReviewRun> {
  let usage = emptyTokenUsage();
  const startedAt = Date.now();
  const outcome = await review(spec, (spent) => {
    usage = addTokenUsage(usage, spent);
  });
  const run: FinishedReviewRun = {
    outcome,
    usage,
    durationMs: Date.now() - startedAt,
  };
  await spec.delivery.publishRun?.(spec.target, run);
  return run;
}

async function review(
  {
    client,
    target,
    delivery: unguarded,
    engine,
    policy = {},
    memory: memorySpec,
    logger = createConsoleLogger(),
    signal,
    stillRunning,
  }: ReviewRunSpec,
  onUsage: (usage: FinishedReviewRun["usage"]) => void,
): Promise<ReviewOutcome> {
  const {
    incremental = false,
    index = true,
    suggestReviewers: suggesting = true,
  } = policy;
  const now = memorySpec?.now ?? (() => new Date());
  const fields = reviewCorrelation(target);
  const cancelled = cancellation(signal, stillRunning, logger, fields);
  const delivery = guarded(unguarded, cancelled.beforeWrite);

  cancelled.check("before start");
  const [pullRequest, changedFiles] = await Promise.all([
    client.getPullRequest(target),
    client.listChangedFiles(target),
  ]);
  logger.info("review.loaded", {
    ...fields,
    changedFileCount: changedFiles.length,
  });
  const tree: ReviewedTree = { baseSha: pullRequest.baseSha, changedFiles };

  // The agent sees the scope; publishing sees the whole PR, so comments anchor anywhere.
  const scope = await resolveReviewScope(target, {
    client,
    incremental,
    changedFiles,
    logger,
  });
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
    await delivery.publishCheckRun(
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
    GENERAL_AGENT,
    memorySpec?.store,
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

  cancelled.check("agent");
  const agent = engine.createAgent({
    agent: hinted,
    github: client,
    index: repositoryIndex,
    logger,
    onUsage: (report) => onUsage(report.usage),
  });
  const [candidates, suggestedReviewers] = await Promise.all([
    agent
      .run({
        owner: target.owner,
        repo: target.repo,
        pullRequest,
        changedFiles: scope.changedFiles,
        pullRequestFiles: scope.pullRequestFiles,
        sinceSha: scope.sinceSha,
        signal,
      })
      .then(
        (proposed) => [...proposed],
        (error: unknown) => cancelled.fromError(error, "agent"),
      ),
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
  cancelled.check("agent");

  // The AI boundary: only what passes validation reaches GitHub.
  const findings = validateFindings(candidates, scope.changedFiles, [
    agent.name,
  ]);
  logger.info("findings.validated", {
    ...fields,
    candidateCount: candidates.length,
    findingCount: findings.length,
  });

  const { kept, suppressed } = partitionSuppressed(memory, findings);
  if (suppressed.length > 0) {
    logger.info("findings.suppressed", {
      ...fields,
      suppressedCount: suppressed.length,
      titles: suppressed.map((finding) => finding.title),
    });
  }

  // A patch is proved against the head commit before any of it can be committed or offered.
  const verified = await verifyPatches(kept, scope.pullRequestFiles, {
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

  cancelled.check("before publish");
  await deliverReview(
    target,
    {
      findings: verified.findings,
      diffLines: buildDiffLineIndex(scope.pullRequestFiles),
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
    { ...delivery, logger },
  );

  return {
    candidates,
    findings: verified.findings,
    patches: verified.summary,
    suppressed: suppressed.length,
    ...tree,
    ...(repositoryIndex === undefined
      ? {}
      : { graph: snapshotRepositoryIndex(repositoryIndex) }),
    ...(blastRadius === undefined ? {} : { blastRadius }),
  };
}
