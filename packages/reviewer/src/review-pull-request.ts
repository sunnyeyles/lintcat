/**
 * One review, end to end. The side-effect boundary is enforced here, once,
 * rather than in each delivery-path wrapper.
 */
import {
  emptySynthesisHints,
  gateAgentsByPaths,
  withRepositoryHints,
  type AgentDefinition,
  type SynthesisHints,
} from "@pr-review/ai";
import type {
  ExistingReviewComment,
  PullRequestReadClient,
} from "@pr-review/github";
import {
  createConsoleLogger,
  errorMessage,
  type StructuredLogger,
} from "@pr-review/logging";
import type { ReviewFinding } from "@pr-review/schemas";

import { buildReviewIndex } from "#src/build-index";
import type { ReviewClient, RunReviewPipeline } from "#src/pipeline-runner";
import { buildDiffLineIndex } from "#src/diff-lines";
import { countLabel } from "#src/finding-format";
import { deliverReview } from "#src/publish-review";
import type { ReviewDelivery } from "#src/review-delivery";
import {
  computeHints,
  computeSynthesisHints,
  emptyMemory,
  readMemory,
  type MemoryStore,
} from "#src/memory";
import { renderCheckRun, renderNoAgentMatched } from "#src/render-check-run";
import { verifyPatches, type PatchSummary } from "#src/validate-patches";
import {
  findingKey,
  parsePostedFinding,
  postedFindingKeys,
  type PostedFinding,
} from "#src/render-review";
import {
  skippedSynthesis,
  type ReviewPipelineResult,
} from "#src/review-pipeline";
import { reviewCorrelation, type ReviewTarget } from "#src/review-target";
import { resolveReviewScope, wholePullRequest } from "#src/review-scope";

/** What one review needs once its delivery has already been chosen. */
export interface ReviewWithDeliveryDeps {
  /** Reads only; every write this review makes goes through `delivery`. */
  client: ReviewClient;
  /** The run's agent set, already narrowed by the `agents` input. */
  agents: readonly AgentDefinition[];
  /** Throws only when every agent failed; a synthesis failure is reported on the result. */
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

/** One memory read serves both readers: the agents and the synthesiser. */
interface HintedRun {
  agents: readonly AgentDefinition[];
  synthesisHints: SynthesisHints;
}

/** The run's hints; unhinted when there is no store or the read fails. */
async function attachRepositoryHints(
  agents: readonly AgentDefinition[],
  store: MemoryStore | undefined,
  target: ReviewTarget,
  logger: StructuredLogger,
  now: Date,
): Promise<HintedRun> {
  const unhinted: HintedRun = { agents, synthesisHints: emptySynthesisHints() };
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
  const synthesisHints = computeSynthesisHints(memory, now);

  let hintCount = 0;
  for (const sentences of hints.values()) {
    hintCount += sentences.length;
  }
  logger.info("memory.hints_attached", {
    ...reviewCorrelation(target),
    hintCount,
    agents: agents
      .map((agent) => agent.category)
      .filter((category) => (hints.get(category)?.length ?? 0) > 0),
    synthesisKeepCount: synthesisHints.keep.length,
    synthesisDropCount: synthesisHints.drop.length,
  });
  return {
    agents: agents.map((agent) =>
      withRepositoryHints(agent, hints.get(agent.category) ?? []),
    ),
    synthesisHints,
  };
}

/** Logs the synthesis outcome: skipped, completed, or failed. */
function logSynthesisOutcome(
  logger: StructuredLogger,
  target: ReviewTarget,
  review: ReviewPipelineResult,
): void {
  const fields = reviewCorrelation(target);
  const { synthesis } = review;
  if (synthesis.outcome === "skipped") {
    logger.info("synthesis.skipped", { ...fields, reason: synthesis.reason });
    return;
  }

  logger.info("synthesis.started", {
    ...fields,
    candidateCount: review.candidates.length,
  });
  if (synthesis.outcome === "completed") {
    logger.info("synthesis.completed", {
      ...fields,
      candidateCount: review.candidates.length,
      refinedCount: synthesis.candidates.length,
      ...synthesis.usage,
      durationMs: synthesis.durationMs,
    });
    return;
  }

  logger.error("synthesis.failed", {
    ...fields,
    error: synthesis.error,
    errorName: synthesis.errorName,
    durationMs: synthesis.durationMs,
    fallback: "publishing validated raw findings",
  });
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
  return `> **Note:** No file this pull request changed has moved since \`${sinceSha.slice(0, 7)}\`, so no agent ran.`;
}

/** One review's outcome, plus how the patches its agents proposed fared. */
export interface ReviewOutcome extends ReviewPipelineResult {
  patches: PatchSummary;
}

/** The result of a review that never reached the pipeline. */
function unreviewed(): ReviewOutcome {
  return {
    candidates: [],
    agentFailures: [],
    synthesis: skippedSynthesis("no candidate findings", []),
    findings: [],
    patches: { proposed: 0, verified: 0 },
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
    agents,
    runReviewPipeline,
    delivery,
    logger = createConsoleLogger(),
    memoryStore,
    now = () => new Date(),
    incremental = false,
    index = true,
  }: ReviewWithDeliveryDeps,
): Promise<ReviewOutcome> {
  const fields = reviewCorrelation(target);
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

  const scope = await resolveReviewScope(target, {
    client,
    incremental,
    diff,
    changedFiles,
    logger,
  });
  const whole = wholePullRequest(scope);
  const publish = delivery.publishCheckRun;
  // Agents see the scope; publishing sees the whole PR, so comments anchor anywhere.
  const filenames = scope.changedFiles.map((file) => file.filename);
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
      renderCheckRun([], [], {
        annotate: false,
        carriedForward,
        scopeNote: noNewChangesNote(scope.sinceSha),
      }),
    );
    return unreviewed();
  }

  const { agents: hinted, synthesisHints } = await attachRepositoryHints(
    agents,
    memoryStore,
    target,
    logger,
    now(),
  );

  const { active, skipped } = gateAgentsByPaths(hinted, filenames);
  const skippedNames = skipped.map((skip) => skip.agent);
  for (const skip of skipped) {
    logger.info("agent.skipped", {
      ...fields,
      agent: skip.agent,
      paths: skip.paths,
      reason: "no changed file matched",
    });
  }

  if (active.length === 0) {
    logger.info("review.no_agents_matched", {
      ...fields,
      changedFileCount: changedFiles.length,
      skippedAgents: skippedNames,
    });
    await publish(
      target,
      renderNoAgentMatched(skipped, filenames, carriedForward),
    );
    return unreviewed();
  }

  // Built once, before any agent starts, and thrown away with this review.
  const repositoryIndex = await buildReviewIndex({
    client,
    target,
    baseSha: pullRequest.baseSha,
    enabled: index,
    logger,
  });

  // The AI boundary: only the validate step's output reaches GitHub.
  const review = await runReviewPipeline({
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
    },
    agents: active,
    hints: synthesisHints,
    index: repositoryIndex,
  });
  logSynthesisOutcome(logger, target, review);

  logger.info("findings.validated", {
    ...fields,
    candidateCount: review.synthesis.candidates.length,
    findingCount: review.findings.length,
  });

  // Still inside the AI boundary: a patch is proved against the head commit
  // before any of it can be committed or offered.
  const verified = await verifyPatches(review.findings, whole.changedFiles, {
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

  await deliverReview(
    target,
    {
      findings: verified.findings,
      agentFailures: review.agentFailures,
      skippedAgents: skipped,
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

  return { ...review, findings: verified.findings, patches: verified.summary };
}
