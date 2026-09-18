/**
 * The review pipeline: agent fan-out, join, deterministic validation, and
 * check-run rendering. The synthesiser lives in @pr-review/ai.
 */
export {
  runReviewPipeline,
  type ReviewPipelineResult,
} from "#src/review-pipeline";
export { validateFindings } from "#src/validate-findings";
export type { RenderedCheckRun } from "#src/render-check-run";
export {
  createCheckRunPublisher,
  createFixPublisher,
  type PublishFixes,
  type PublishReview,
  type PublishReviewComments,
} from "#src/publish-review";
export {
  FIX_COMMIT_MARKER,
  isFixCommit,
  type FixOutcome,
} from "#src/apply-fixes";
export {
  verifyPatches,
  type PatchSummary,
  type PatchedFile,
} from "#src/validate-patches";
export {
  reviewPullRequest,
  type ReviewOutcome,
} from "#src/review-pull-request";
export {
  learnFromMergedPullRequest,
  type LearnFromMergeDeps,
} from "#src/learn-from-merge";
export {
  computeHints,
  computeSynthesisHints,
  createBranchMemoryStore,
  emptyMemory,
  MEMORY_FILE_PATH,
  readMemory,
  recordSignals,
  titleShape,
  writeMemory,
  HINT_CAP,
  HINT_IGNORED_THRESHOLD,
  HINT_RESOLVED_THRESHOLD,
  MEMORY_TTL_DAYS,
  SYNTHESIS_HINT_CAP,
  type FindingOutcome,
  type FindingSignal,
  type MemoryStore,
} from "#src/memory";
export {
  categoryMarker,
  findingMarker,
  parsePostedFinding,
  postedFindingKeys,
  renderReview,
  type PostedFinding,
  type RenderedReview,
  type ReviewNotes,
} from "#src/render-review";
export { reviewCorrelation, type ReviewTarget } from "#src/review-target";
