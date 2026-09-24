/** Token-authenticated GitHub client; permissions are whatever the token was granted. */
import { Octokit } from "@octokit/rest";

import { createInstallationClient, type OctokitLike } from "#src/app";
import type {
  PullRequestReadClient,
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "#src/client";

export interface GithubTokenConfig {
  /** An installation token, or a user's token for the MCP server. */
  token: string;
  /** Injectable Octokit factory; defaults to a real token-authenticated Octokit. */
  createOctokit?: ((token: string) => OctokitLike) | undefined;
}

/** Nothing downstream depends on how the Octokit behind this was authenticated. */
export function createTokenClient(
  config: GithubTokenConfig,
): PullRequestReadClient & RepositoryHistoryClient & ReviewPublishClient {
  const createOctokit =
    config.createOctokit ?? ((token: string) => new Octokit({ auth: token }));
  return createInstallationClient(createOctokit(config.token));
}
