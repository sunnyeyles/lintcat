import { createHmac, timingSafeEqual } from "node:crypto";

import {
  deleteInstallation,
  findOrganizationByAccountId,
  removeRepositories,
  replaceRepositories,
  setInstallationSuspended,
  upsertInstallation,
  upsertRepositories,
  type Database,
  type InstallationInput,
  type RepositoryInput,
} from "@pr-review/db";
import type { GithubAppClient } from "@pr-review/github";
import type { StructuredLogger } from "@pr-review/logging";
import { z } from "zod";

import {
  applyMembership,
  installedAccount,
  lookupMembers,
  lookupMembership,
  replaceMembers,
} from "@/lib/membership-sync";

export interface GithubWebhookDeps {
  /** Must support `.transaction()`: the WebSocket pool in production, PGlite in tests. */
  database: Database;
  github: GithubAppClient;
  logger: StructuredLogger;
  webhookSecret: string;
}

const installationSchema = z.object({
  id: z.number(),
  account: z.object({
    id: z.number(),
    login: z.string(),
    type: z.string(),
  }),
  suspended_at: z.string().nullish(),
});

const installationEventSchema = z.object({
  action: z.string(),
  installation: installationSchema,
});

const payloadRepositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
});

const installationRepositoriesEventSchema = installationEventSchema.extend({
  repositories_added: z.array(payloadRepositorySchema),
  repositories_removed: z.array(payloadRepositorySchema.pick({ id: true })),
});

const payloadUserSchema = z.object({
  id: z.number(),
  login: z.string(),
  avatar_url: z.string().nullish(),
});

const payloadOrganizationSchema = z.object({ id: z.number(), login: z.string() });

const organizationEventSchema = z.object({
  action: z.string(),
  organization: payloadOrganizationSchema,
  membership: z.object({ user: payloadUserSchema.nullable() }).optional(),
});

// `member` (repository collaborator) and `membership` (team) both name the user `member`.
const memberEventSchema = z.object({
  action: z.string(),
  organization: payloadOrganizationSchema.optional(),
  member: payloadUserSchema.nullable(),
});

const MEMBER_ACTIONS: Record<string, readonly string[]> = {
  organization: ["member_added", "member_removed"],
  member: ["added", "edited", "removed"],
  membership: ["added", "removed"],
};

/** The route body, with its collaborators passed in so tests need no Neon or GitHub. */
export async function handleGithubWebhook(
  request: Request,
  deps: GithubWebhookDeps,
): Promise<Response> {
  const body = Buffer.from(await request.arrayBuffer());
  if (
    !validSignature(
      deps.webhookSecret,
      body,
      request.headers.get("x-hub-signature-256"),
    )
  ) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  const run = dispatch(event, deps);
  if (!run) return ignored();

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const handled = await run(payload);
  if (handled instanceof Response) return handled;
  if (!handled) return ignored();
  return Response.json({ event }, { status: 200 });
}

function dispatch(
  event: string,
  deps: GithubWebhookDeps,
): ((payload: unknown) => Promise<boolean | Response>) | undefined {
  switch (event) {
    case "installation":
      return (payload) =>
        withPayload(installationEventSchema, payload, (data) =>
          onInstallation(deps, data),
        );
    case "installation_repositories":
      return (payload) =>
        withPayload(installationRepositoriesEventSchema, payload, (data) =>
          onInstallationRepositories(deps.database, data),
        );
    case "organization":
      return (payload) =>
        withPayload(organizationEventSchema, payload, (data) =>
          onMemberChanged(deps, event, data.action, data.organization, data.membership?.user),
        );
    case "member":
    case "membership":
      return (payload) =>
        withPayload(memberEventSchema, payload, (data) =>
          onMemberChanged(deps, event, data.action, data.organization, data.member),
        );
    default:
      return undefined;
  }
}

async function withPayload<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  run: (data: T) => Promise<boolean>,
): Promise<boolean | Response> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid webhook payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  return run(parsed.data);
}

async function onInstallation(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof installationEventSchema>,
): Promise<boolean> {
  const { database, github } = deps;
  const installation = toInstallation(payload.installation);
  if (!installation) return false;
  const source = `installation.${payload.action}`;
  switch (payload.action) {
    case "created": {
      // Fetched before the transaction opens, so no connection idles on GitHub.
      const listed = await github.listInstallationRepositories(
        installation.installationId,
      );
      const members = await lookupMembers(github, installation);
      const repositories = listed.map(
        (repo): RepositoryInput => ({
          githubRepoId: repo.id,
          owner: repo.owner,
          name: repo.name,
          private: repo.private,
        }),
      );
      await database.transaction(async (tx) => {
        const organization = await upsertInstallation(tx, installation);
        await replaceRepositories(tx, organization.id, repositories);
        await replaceMembers({ ...deps, database: tx }, organization, members, source);
      });
      return true;
    }
    case "deleted":
      await deleteInstallation(database, installation.accountId);
      return true;
    case "suspend":
      await setInstallationSuspended(
        database,
        installation.accountId,
        installation.suspendedAt ?? new Date(),
      );
      return true;
    case "unsuspend": {
      // No deliveries arrive while suspended, so members may have drifted.
      const members = await lookupMembers(github, installation);
      await database.transaction(async (tx) => {
        await setInstallationSuspended(tx, installation.accountId, null);
        const organization = await findOrganizationByAccountId(tx, installation.accountId);
        if (organization) {
          await replaceMembers({ ...deps, database: tx }, organization, members, source);
        }
      });
      return true;
    }
    default:
      return false;
  }
}

async function onInstallationRepositories(
  database: Database,
  payload: z.infer<typeof installationRepositoriesEventSchema>,
): Promise<boolean> {
  const installation = toInstallation(payload.installation);
  if (!installation) return false;
  if (payload.action !== "added" && payload.action !== "removed") return false;
  await database.transaction(async (tx) => {
    const organization = await upsertInstallation(tx, installation);
    await upsertRepositories(
      tx,
      organization.id,
      payload.repositories_added.map((repo) => ({
        githubRepoId: repo.id,
        owner: repo.full_name.split("/")[0] ?? installation.login,
        name: repo.name,
        private: repo.private,
      })),
    );
    await removeRepositories(
      tx,
      organization.id,
      payload.repositories_removed.map((repo) => repo.id),
    );
  });
  return true;
}

// The payload's role is not trusted: GitHub is asked for the current one, so reordered deliveries converge.
async function onMemberChanged(
  deps: GithubWebhookDeps,
  event: string,
  action: string,
  payloadOrganization: z.infer<typeof payloadOrganizationSchema> | undefined,
  user: z.infer<typeof payloadUserSchema> | null | undefined,
): Promise<boolean> {
  if (!MEMBER_ACTIONS[event]?.includes(action) || !payloadOrganization || !user) {
    return false;
  }
  const source = `${event}.${action}`;
  const account = {
    githubId: user.id,
    login: user.login,
    avatarUrl: user.avatar_url ?? null,
  };
  const organization = await findOrganizationByAccountId(
    deps.database,
    payloadOrganization.id,
  );
  const installed = organization && installedAccount(organization);
  const skip = (reason: string) => {
    deps.logger.info("membership.skipped", {
      source,
      organization: payloadOrganization.login.toLowerCase(),
      githubUserId: account.githubId,
      login: account.login,
      reason,
    });
    return false;
  };
  if (!organization || !installed) return skip("organization_not_installed");
  if (organization.suspendedAt) return skip("installation_suspended");

  const decision = await lookupMembership(deps.github, installed, account);
  await deps.database.transaction((tx) =>
    applyMembership({ ...deps, database: tx }, organization, { account, decision }, source),
  );
  return true;
}

function toInstallation(
  installation: z.infer<typeof installationSchema>,
): InstallationInput | undefined {
  const { type } = installation.account;
  const accountType =
    type === "Organization" ? "organization" : type === "User" ? "user" : undefined;
  if (!accountType) return undefined;
  return {
    installationId: installation.id,
    accountId: installation.account.id,
    accountType,
    login: installation.account.login,
    suspendedAt: installation.suspended_at
      ? new Date(installation.suspended_at)
      : null,
  };
}

function validSignature(
  secret: string,
  body: Buffer,
  header: string | null,
): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function ignored(): Response {
  return new Response(null, { status: 204 });
}
