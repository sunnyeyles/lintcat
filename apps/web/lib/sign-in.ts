import { withWriteDatabase, type User } from "@pr-review/db";
import { createConsoleLogger, errorMessage } from "@pr-review/logging";

import { githubApp } from "@/lib/github-app";
import { syncSignInMemberships } from "@/lib/membership-sync";
import { upsertGithubUser, type GithubUserProfile } from "@/lib/users";

/** Mirrors the user, then refreshes their memberships; a failed refresh never blocks sign-in. */
export async function signInUser(profile: GithubUserProfile): Promise<User> {
  const logger = createConsoleLogger();
  return withWriteDatabase(async (database) => {
    const user = await upsertGithubUser(database, profile);
    try {
      await syncSignInMemberships(
        { database, github: githubApp(), logger },
        { githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl },
      );
    } catch (error) {
      logger.error("membership.sign_in_sync_failed", {
        githubUserId: user.githubId,
        login: user.login,
        error: errorMessage(error),
      });
    }
    return user;
  });
}
