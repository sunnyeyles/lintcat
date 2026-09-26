/** The local-checkout review path, for entry points that are not MCP clients. */
export { git, GitError } from "#src/git";
export {
  hasModelApiKey,
  processEnvironment,
  type McpEnvironment,
} from "#src/environment";
export { chooseScope, repositoryRoot, type LocalScope } from "#src/local-git-client";
export { reviewLocalCheckout } from "#src/local-review-run";
export { modelReviewEngine } from "#src/review-engine";
