import { withWriteDatabase, type User } from "@pr-review/db";
import { createConsoleLogger, errorMessage } from "@pr-review/logging";

import { githubApp } from "@/lib/github-app";
import { syncSignInMemberships } from "@/lib/membership-sync";
import { syncSignInRepoAccess } from "@/lib/repo-access-sync";
import { upsertGithubUser, type GithubUserProfile } from "@/lib/users";

/** Mirrors the user, then refreshes memberships and repo access; a failed refresh never blocks sign-in. */
export async function signInUser(profile: GithubUserProfile): Promise<User> {
  const logger = createConsoleLogger();
  return withWriteDatabase(async (database) => {
    const user = await upsertGithubUser(database, profile);
    const account = { githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl };
    for (const [failure, sync] of [
      ["membership.sign_in_sync_failed", syncSignInMemberships],
      ["repo_access.sign_in_sync_failed", syncSignInRepoAccess],
    ] as const) {
      try {
        await sync({ database, github: githubApp(), logger }, account);
      } catch (error) {
        logger.error(failure, {
          githubUserId: user.githubId,
          login: user.login,
          error: errorMessage(error),
        });
      }
    }
    return user;
  });
}
