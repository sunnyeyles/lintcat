import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { requiredEnv } from "@pr-review/logging";
import { z } from "zod";

import { notFoundAs } from "#src/errors";
import { PAGE_SIZE } from "#src/paginate";

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

export type RepositoryPermission = "admin" | "maintain" | "write" | "triage" | "read";

export interface RepositoryCollaborator {
  id: number;
  login: string;
  permission: RepositoryPermission;
}

export interface AppInstallation {
  id: number;
  account: { id: number; login: string; type: string };
  suspendedAt: Date | null;
}

/** What the dashboard asks GitHub as the App; tests pass a fake. */
export interface GithubAppClient {
  /** The installation as GitHub records it; read with the App's JWT, not an installation token. */
  getInstallation(installationId: number): Promise<AppInstallation>;
  /** A newly minted installation token; the caller holds it in memory for one job only. */
  createInstallationToken(installationId: number): Promise<string>;
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
  /** Null when `username` cannot read the repo. */
  getRepositoryPermission(
    installationId: number,
    owner: string,
    repo: string,
    username: string,
  ): Promise<RepositoryCollaborator | null>;
  /** Everyone who can read the repo, through any grant: direct, team, organization base role. */
  listRepositoryCollaborators(
    installationId: number,
    owner: string,
    repo: string,
  ): Promise<RepositoryCollaborator[]>;
}

/**
 * The slice of Octokit this module consumes. Octokit satisfies it
 * structurally; tests inject a stub so no real network calls happen.
 */
export interface AppOctokitLike {
  auth(options: { type: "installation"; refresh?: boolean }): Promise<unknown>;
  paginate(route: unknown, params: Record<string, unknown>): Promise<unknown[]>;
  rest: {
    apps: {
      listReposAccessibleToInstallation: unknown;
      getInstallation(params: { installation_id: number }): Promise<{ data: unknown }>;
    };
    orgs: {
      listMembers: unknown;
      getMembershipForUser(params: {
        org: string;
        username: string;
      }): Promise<{ data: unknown }>;
    };
    repos: {
      listCollaborators: unknown;
      getCollaboratorPermissionLevel(params: {
        owner: string;
        repo: string;
        username: string;
      }): Promise<{ data: unknown }>;
    };
  };
}

/** Resolves the Octokit authenticated for one installation. */
export type InstallationOctokit = (installationId: number) => AppOctokitLike;

const PERMISSIONS: readonly RepositoryPermission[] = [
  "admin",
  "maintain",
  "write",
  "triage",
  "read",
];

// role_name carries maintain and triage; a custom role falls back to the legacy base permission.
export function repositoryPermission(
  roleName: string | null | undefined,
  permission: string | null | undefined,
): RepositoryPermission | null {
  for (const candidate of [roleName, permission]) {
    const match = PERMISSIONS.find((known) => known === candidate);
    if (match) return match;
  }
  return null;
}

const FLAG_PERMISSIONS: readonly [string, RepositoryPermission][] = [
  ["admin", "admin"],
  ["maintain", "maintain"],
  ["push", "write"],
  ["triage", "triage"],
  ["pull", "read"],
];

// For a custom role: the highest permission flag set wins.
export function highestFlag(
  flags: Record<string, boolean> | null | undefined,
): RepositoryPermission | null {
  return FLAG_PERMISSIONS.find(([flag]) => flags?.[flag])?.[1] ?? null;
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

const permissionFlagsSchema = z.record(z.string(), z.boolean()).nullish();

const collaboratorSchema = z.object({
  id: z.number(),
  login: z.string(),
  role_name: z.string().nullish(),
  permissions: permissionFlagsSchema,
});

const permissionLevelSchema = z.object({
  permission: z.string(),
  role_name: z.string().nullish(),
  user: collaboratorSchema.nullable(),
});

const membershipSchema = z.object({
  state: z.string(),
  role: z.string(),
  user: memberSchema.nullable(),
});

// The same shape arrives in API responses and webhook payloads.
export const installationSchema = z
  .object({
    id: z.number(),
    account: z.object({ id: z.number(), login: z.string(), type: z.string() }),
    suspended_at: z.string().nullish(),
  })
  .transform(
    ({ id, account, suspended_at }): AppInstallation => ({
      id,
      account,
      suspendedAt: suspended_at ? new Date(suspended_at) : null,
    }),
  );

/** Wraps per-installation Octokits in the App client; authentication is the caller's only job. */
export function createAppClient(installation: InstallationOctokit): GithubAppClient {
  return {
    async getInstallation(installationId) {
      const { data } = await installation(installationId).rest.apps.getInstallation({
        installation_id: installationId,
      });
      return installationSchema.parse(data);
    },

    async createInstallationToken(installationId) {
      const auth = await installation(installationId).auth({
        type: "installation",
        refresh: true,
      });
      return z.object({ token: z.string().min(1) }).parse(auth).token;
    },

    async listInstallationRepositories(installationId) {
      const octokit = installation(installationId);
      const data = await octokit.paginate(
        octokit.rest.apps.listReposAccessibleToInstallation,
        { per_page: PAGE_SIZE },
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
              per_page: PAGE_SIZE,
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
      const response = await notFoundAs(null, () =>
        installation(installationId).rest.orgs.getMembershipForUser({ org, username }),
      );
      if (response === null) return null;
      const membership = membershipSchema.parse(response.data);
      if (membership.state !== "active" || !membership.user) return null;
      return {
        id: membership.user.id,
        login: membership.user.login,
        avatarUrl: membership.user.avatar_url ?? null,
        role: membership.role === "admin" ? "admin" : "member",
      };
    },

    async getRepositoryPermission(installationId, owner, repo, username) {
      const response = await notFoundAs(null, () =>
        installation(installationId).rest.repos.getCollaboratorPermissionLevel({
          owner,
          repo,
          username,
        }),
      );
      if (response === null) return null;
      const level = permissionLevelSchema.parse(response.data);
      const permission =
        level.permission === "none"
          ? null
          : repositoryPermission(level.role_name, level.permission);
      if (!permission || !level.user) return null;
      return { id: level.user.id, login: level.user.login, permission };
    },

    async listRepositoryCollaborators(installationId, owner, repo) {
      const octokit = installation(installationId);
      const data = await octokit.paginate(octokit.rest.repos.listCollaborators, {
        owner,
        repo,
        affiliation: "all",
        per_page: PAGE_SIZE,
      });
      return z
        .array(collaboratorSchema)
        .parse(data)
        .flatMap((collaborator) => {
          const permission =
            repositoryPermission(collaborator.role_name, null) ??
            highestFlag(collaborator.permissions);
          return permission
            ? [{ id: collaborator.id, login: collaborator.login, permission }]
            : [];
        });
    },
  };
}

/** Signs a JWT as the App; each installation's token is cached and refreshed by its Octokit. */
export function createGithubAppClient(config: GithubAppConfig): GithubAppClient {
  const clients = new Map<number, AppOctokitLike>();
  return createAppClient((installationId) => {
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
  });
}

// Single-line env values carry the PEM's newlines as literal `\n`.
export function githubAppClientFromEnv(): GithubAppClient {
  return createGithubAppClient({
    appId: requiredEnv("GITHUB_APP_ID"),
    privateKey: requiredEnv("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
  });
}
