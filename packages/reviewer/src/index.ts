/**
 * The review pipeline: agent fan-out, join, deterministic validation, and
 * check-run rendering. The synthesiser lives in @pr-review/ai.
 */
export {
  runReviewPipeline,
  type ReviewPipelineResult,
} from "#src/review-pipeline";
export {
  createPipelineRunner,
  type PipelineRunnerDeps,
  type ReviewClient,
  type ReviewPipelineRun,
  type RunReviewPipeline,
} from "#src/pipeline-runner";
export { readAtCommit } from "#src/read-at-commit";
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
  createDashboardPublisher,
  type DashboardPublisherConfig,
  type DashboardReview,
  type PublishToDashboard,
} from "#src/publish-dashboard";
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
  reviewWithDelivery,
  type ReviewOutcome,
  type ReviewWithDeliveryDeps,
} from "#src/review-pull-request";
export {
  dashboardDelivery,
  dashboardReview,
  githubDelivery,
  recordingDelivery,
  type FinishedReviewRun,
  type GithubDeliveryConfig,
  type PublishReviewRun,
  type RecordedDelivery,
  type RecordingDelivery,
  type ReviewDelivery,
} from "#src/review-delivery";
export {
  runReview,
  type CreateReviewAgents,
  type ReviewAgentRequest,
  type ReviewAgentSource,
  type ReviewEngine,
  type ReviewMemory,
  type ReviewPolicy,
  type ReviewRunSpec,
} from "#src/review-run";
export { buildReviewIndex, type ReviewIndexRequest } from "#src/build-index";
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
