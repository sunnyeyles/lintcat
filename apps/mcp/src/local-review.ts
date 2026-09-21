/** The local-checkout review path, for entry points that are not MCP clients. */
export { git, GitError } from "#src/git";
export {
  hasModelApiKey,
  processEnvironment,
  type McpEnvironment,
} from "#src/environment";
export {
  openLocalRepository,
  repositoryRoot,
  type LocalRepository,
  type LocalScope,
  type ResolvedScope,
} from "#src/local-git-client";
export { REMOVED_AGENTS_FLAG } from "#src/legacy-agent-config";
export { openLocalMemoryStore, type LocalMemoryStore } from "#src/local-memory-store";
export { runReview, type ReviewRequest, type ReviewResult } from "#src/review";
export { modelReviewEngine, type SelectedEngine } from "#src/review-engine";
