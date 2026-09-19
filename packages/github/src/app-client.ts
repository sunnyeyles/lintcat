import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

import { httpStatus } from "#src/errors";

export interface InstallationRepository {
  id: number;
  owner: string;
  name: string;
  private: boolean;
}

export type OrganizationRole = "admin" | "member";

export interface OrganizationMember {
  id: number;
  login: string;
  avatarUrl: string | null;
  role: OrganizationRole;
}

/** What the dashboard asks GitHub as the App; tests pass a fake. */
export interface GithubAppClient {
  listInstallationRepositories(
    installationId: number,
  ): Promise<InstallationRepository[]>;
  /** Every active member of `org`, with their role. */
  listOrganizationMembers(
    installationId: number,
    org: string,
  ): Promise<OrganizationMember[]>;
  /** Null when `username` is not an active member (absent, or only invited). */
  getOrganizationMembership(
    installationId: number,
    org: string,
    username: string,
  ): Promise<OrganizationMember | null>;
}

export interface GithubAppConfig {
  appId: string;
  /** The App's PEM private key. */
  privateKey: string;
}

const repositoriesSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    private: z.boolean(),
    owner: z.object({ login: z.string() }),
  }),
);

const memberSchema = z.object({
  id: z.number(),
  login: z.string(),
  avatar_url: z.string().nullish(),
});

const membershipSchema = z.object({
  state: z.string(),
  role: z.string(),
  user: memberSchema.nullable(),
});

/** Signs a JWT as the App; each installation's token is cached and refreshed by its Octokit. */
export function createGithubAppClient(config: GithubAppConfig): GithubAppClient {
  const clients = new Map<number, Octokit>();
  const installation = (installationId: number): Octokit => {
    let octokit = clients.get(installationId);
    if (!octokit) {
      octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.appId,
          privateKey: config.privateKey,
          installationId,
        },
      });
      clients.set(installationId, octokit);
    }
    return octokit;
  };

  return {
    async listInstallationRepositories(installationId) {
      const octokit = installation(installationId);
      const data = await octokit.paginate(
        octokit.rest.apps.listReposAccessibleToInstallation,
        { per_page: 100 },
      );
      return repositoriesSchema.parse(data).map((repo) => ({
        id: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        private: repo.private,
      }));
    },

    async listOrganizationMembers(installationId, org) {
      const octokit = installation(installationId);
      // The members list carries no role, so admins are listed separately.
      const list = async (role: "admin" | "all") =>
        z
          .array(memberSchema)
          .parse(
            await octokit.paginate(octokit.rest.orgs.listMembers, {
              org,
              role,
              per_page: 100,
            }),
          );
      const admins = new Set((await list("admin")).map((member) => member.id));
      return (await list("all")).map((member) => ({
        id: member.id,
        login: member.login,
        avatarUrl: member.avatar_url ?? null,
        role: admins.has(member.id) ? "admin" : "member",
      }));
    },

    async getOrganizationMembership(installationId, org, username) {
      let data: unknown;
      try {
        ({ data } = await installation(installationId).rest.orgs.getMembershipForUser(
          { org, username },
        ));
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
      const membership = membershipSchema.parse(data);
      if (membership.state !== "active" || !membership.user) return null;
      return {
        id: membership.user.id,
        login: membership.user.login,
        avatarUrl: membership.user.avatar_url ?? null,
        role: membership.role === "admin" ? "admin" : "member",
      };
    },
  };
}
