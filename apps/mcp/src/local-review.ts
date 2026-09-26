/** The local-checkout review path, for entry points that are not MCP clients. */
export { git, GitError } from "#src/git";
export {
  hasModelApiKey,
  processEnvironment,
  type McpEnvironment,
} from "#src/environment";
export {
  chooseScope,
  LOCAL_SCOPE_KINDS,
  openLocalRepository,
  repositoryRoot,
  type LocalRepository,
  type LocalScope,
  type ResolvedScope,
} from "#src/local-git-client";
export { openLocalMemoryStore, type LocalMemoryStore } from "#src/local-memory-store";
export {
  reviewLocalCheckout,
  type LocalReviewRequest,
  type LocalReviewRun,
} from "#src/local-review-run";
export { runReview, type ReviewRequest, type ReviewResult } from "#src/review";
export { modelReviewEngine, type SelectedEngine } from "#src/review-engine";
