import { withWriteDatabase, type User } from "@pr-review/db";
import { createGithubUserClient } from "@pr-review/github";
import { createConsoleLogger, errorMessage } from "@pr-review/logging";

import { githubApp } from "@/lib/github-app";
import { syncSignInMemberships } from "@/lib/membership-sync";
import { syncSignInCollaboratorAccess, syncSignInRepoAccess } from "@/lib/repo-access-sync";
import { upsertGithubUser, type GithubUserProfile } from "@/lib/users";

/** Mirrors the user, then refreshes memberships and repo access; a failed refresh never blocks sign-in. */
export async function signInUser(profile: GithubUserProfile, userToken?: string): Promise<User> {
  const logger = createConsoleLogger();
  return withWriteDatabase(async (database) => {
    const user = await upsertGithubUser(database, profile);
    const account = { githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl };
    const deps = {
      database,
      github: githubApp(),
      userGithub: userToken ? createGithubUserClient(userToken) : undefined,
      logger,
    };
    for (const [failure, sync] of [
      ["membership.sign_in_sync_failed", syncSignInMemberships],
      ["repo_access.sign_in_sync_failed", syncSignInRepoAccess],
      ["repo_access.collaborator_sync_failed", syncSignInCollaboratorAccess],
    ] as const) {
      try {
        await sync(deps, account);
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
