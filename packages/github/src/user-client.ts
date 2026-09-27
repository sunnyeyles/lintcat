import { Octokit } from "@octokit/rest";
import { z } from "zod";

import {
  highestFlag,
  repositoryPermission,
  type InstallationRepository,
  type RepositoryPermission,
} from "#src/app-client";

export interface UserInstallation {
  id: number;
  account: { id: number; login: string; type: string };
}

export type UserRepository = InstallationRepository & { permission: RepositoryPermission };

/** What the dashboard asks GitHub as the signed-in user, through the App; tests pass a fake. */
export interface GithubUserClient {
  /** The App's installations this user can reach: owned, member of, or collaborator on. */
  listInstallations(): Promise<UserInstallation[]>;
  /** The installation's repos this user can read, with their permission on each. */
  listInstallationRepositories(installationId: number): Promise<UserRepository[]>;
}

/** The slice of Octokit this module consumes; tests inject a stub. */
export interface UserOctokitLike {
  paginate(route: unknown, params: Record<string, unknown>): Promise<unknown[]>;
  rest: {
    apps: {
      listInstallationsForAuthenticatedUser: unknown;
      listInstallationReposForAuthenticatedUser: unknown;
    };
  };
}

const installationsSchema = z.array(
  z.object({
    id: z.number(),
    account: z.object({ id: z.number(), login: z.string(), type: z.string() }),
  }),
);

const repositoriesSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    private: z.boolean(),
    owner: z.object({ login: z.string() }),
    role_name: z.string().nullish(),
    permissions: z.record(z.string(), z.boolean()).nullish(),
  }),
);

export function createUserClient(octokit: UserOctokitLike): GithubUserClient {
  return {
    async listInstallations() {
      const data = await octokit.paginate(
        octokit.rest.apps.listInstallationsForAuthenticatedUser,
        { per_page: 100 },
      );
      return installationsSchema
        .parse(data)
        .map((installation) => ({ id: installation.id, account: installation.account }));
    },

    async listInstallationRepositories(installationId) {
      const data = await octokit.paginate(
        octokit.rest.apps.listInstallationReposForAuthenticatedUser,
        { installation_id: installationId, per_page: 100 },
      );
      return repositoriesSchema.parse(data).flatMap((repo) => {
        const permission =
          repositoryPermission(repo.role_name, null) ?? highestFlag(repo.permissions);
        return permission
          ? [
              {
                id: repo.id,
                owner: repo.owner.login,
                name: repo.name,
                private: repo.private,
                permission,
              },
            ]
          : [];
      });
    },
  };
}

/** Authenticates as the user with their GitHub App user access token. */
export function createGithubUserClient(token: string): GithubUserClient {
  return createUserClient(new Octokit({ auth: token }));
}
