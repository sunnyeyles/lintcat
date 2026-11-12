/** The local-checkout review path shared by the CLI and the MCP server. */
export { git, GitError } from "#src/git";
export {
  hasModelApiKey,
  processEnvironment,
  resolveGithubToken,
  type LocalEnvironment,
} from "#src/environment";
export {
  openLocalRepository,
  readWorkingTreeFile,
  repositoryRoot,
  resolveInside,
  searchWorkingTree,
  type LocalRepository,
  type LocalScope,
  type ResolvedScope,
} from "#src/local-git-client";
export { createLocalIndexCache, type LocalIndex } from "#src/local-index";
export { openLocalMemoryStore, type LocalMemoryStore } from "#src/local-memory-store";
export { runReview, type ReviewRequest, type ReviewResult } from "#src/review";
export { modelReviewEngine, type SelectedEngine } from "#src/review-engine";
