import { createHmac, timingSafeEqual } from "node:crypto";

import {
  deleteInstallation,
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
import { z } from "zod";

export interface GithubWebhookDeps {
  /** Must support `.transaction()`: the WebSocket pool in production, PGlite in tests. */
  database: Database;
  github: GithubAppClient;
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

  const event = request.headers.get("x-github-event");
  if (event !== "installation" && event !== "installation_repositories") {
    return ignored();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const handled =
    event === "installation"
      ? await withPayload(installationEventSchema, payload, (data) =>
          onInstallation(deps, data),
        )
      : await withPayload(installationRepositoriesEventSchema, payload, (data) =>
          onInstallationRepositories(deps.database, data),
        );
  if (handled instanceof Response) return handled;
  if (!handled) return ignored();
  return Response.json({ event }, { status: 200 });
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
  { database, github }: GithubWebhookDeps,
  payload: z.infer<typeof installationEventSchema>,
): Promise<boolean> {
  const installation = toInstallation(payload.installation);
  if (!installation) return false;
  switch (payload.action) {
    case "created": {
      // Fetched before the transaction opens, so no connection idles on GitHub.
      const listed = await github.listInstallationRepositories(
        installation.installationId,
      );
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
    case "unsuspend":
      await setInstallationSuspended(database, installation.accountId, null);
      return true;
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
