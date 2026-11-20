/** The local-checkout review path, for entry points that are not MCP clients. */
export { git } from "#src/git";
export {
  hasModelApiKey,
  processEnvironment,
  type McpEnvironment,
} from "#src/environment";
export {
  openLocalRepository,
  repositoryRoot,
  type LocalScope,
} from "#src/local-git-client";
export { openLocalMemoryStore } from "#src/local-memory-store";
export { runReview } from "#src/review";
export { modelReviewEngine } from "#src/review-engine";
