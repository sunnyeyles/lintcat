import { createHmac, timingSafeEqual } from "node:crypto";

import {
  effectiveRepoSettings,
  enqueueReviewJob,
  findOrganizationByAccountId,
  findOrganizationById,
  findRepoByGithubId,
  markUninstalled,
  removeRepositories,
  removeRepository,
  replaceRepoAccess,
  setInstallationSuspended,
  updateRepository,
  upsertAccountUser,
  upsertInstallation,
  upsertRepositories,
  type InstallationInput,
  type Organization,
  type RepoPermission,
  type RepoReviewMode,
} from "@pr-review/db";
import { errorMessage } from "@pr-review/logging";
import { z } from "zod";

import {
  followRename,
  installOrganization,
  toInstallation,
  type InstallationDeps,
} from "@/lib/installation";
import {
  applyMembership,
  installedAccount,
  lookupMembers,
  lookupMembership,
  replaceMembers,
} from "@/lib/membership-sync";
import { applyRepoAccess, lookupRepoPermission } from "@/lib/repo-access-sync";
import type { PingWorker } from "@/lib/worker-ping";

export interface GithubWebhookDeps extends InstallationDeps {
  webhookSecret: string;
  pingWorker: PingWorker;
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

function fromPayload({
  suspended_at,
  ...installation
}: z.infer<typeof installationSchema>): InstallationInput | undefined {
  return toInstallation({
    ...installation,
    suspendedAt: suspended_at ? new Date(suspended_at) : null,
  });
}

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
  repository: z.object({ id: z.number() }).optional(),
});

const repositoryEventSchema = z.object({
  action: z.string(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    private: z.boolean(),
    owner: z.object({ id: z.number(), login: z.string() }),
  }),
});

const pullRequestEventSchema = z.object({
  action: z.string(),
  label: z.object({ name: z.string() }).optional(),
  pull_request: z.object({
    number: z.number(),
    state: z.string(),
    head: z.object({ sha: z.string() }),
    labels: z.array(z.object({ name: z.string() })),
  }),
  repository: z.object({ id: z.number() }),
});

/** Adding this label to a pull request asks for a hosted review. */
const REVIEW_LABEL = "ai-review";

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
  const run = dispatch(event, deps, request.headers.get("x-github-delivery"));
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
  deliveryId: string | null,
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
          onInstallationRepositories(deps, data),
        );
    case "organization":
      return (payload) =>
        withPayload(organizationEventSchema, payload, (data) =>
          data.action === "renamed"
            ? onOrganizationRenamed(deps, data.organization)
            : onMemberChanged(deps, event, data.action, data.organization, data.membership?.user),
        );
    case "member":
    case "membership":
      return (payload) =>
        withPayload(memberEventSchema, payload, (data) =>
          onMemberChanged(
            deps,
            event,
            data.action,
            data.organization,
            data.member,
            event === "member" ? data.repository : undefined,
          ),
        );
    case "repository":
      return (payload) =>
        withPayload(repositoryEventSchema, payload, (data) => onRepository(deps, data));
    case "pull_request":
      return (payload) =>
        withPayload(pullRequestEventSchema, payload, (data) =>
          onPullRequest(deps, data, deliveryId),
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
  const installation = fromPayload(payload.installation);
  if (!installation) return false;
  const source = `installation.${payload.action}`;
  switch (payload.action) {
    case "created":
      await installOrganization(deps, installation, source);
      return true;
    case "deleted":
      await database.transaction(async (tx) => {
        await followRename(deps, tx, installation, source);
        await markUninstalled(tx, installation.accountId);
      });
      return true;
    case "suspend":
      await database.transaction(async (tx) => {
        await followRename(deps, tx, installation, source);
        await setInstallationSuspended(
          tx,
          installation.accountId,
          installation.suspendedAt ?? new Date(),
        );
      });
      return true;
    case "new_permissions_accepted":
      return database.transaction((tx) => followRename(deps, tx, installation, source));
    case "unsuspend": {
      // No deliveries arrive while suspended, so members may have drifted.
      const members = await lookupMembers(github, installation);
      await database.transaction(async (tx) => {
        await followRename(deps, tx, installation, source);
        await setInstallationSuspended(tx, installation.accountId, null);
        const organization = await findOrganizationByAccountId(tx, installation.accountId);
        if (organization && !organization.uninstalledAt) {
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
  deps: GithubWebhookDeps,
  payload: z.infer<typeof installationRepositoriesEventSchema>,
): Promise<boolean> {
  const { database } = deps;
  const installation = fromPayload(payload.installation);
  if (!installation) return false;
  if (payload.action !== "added" && payload.action !== "removed") return false;
  // Only `created` brings an uninstalled organization back, so a late delivery cannot.
  const existing = await findOrganizationByAccountId(database, installation.accountId);
  if (existing?.uninstalledAt) return false;
  const source = `installation_repositories.${payload.action}`;
  // A missed `created` leaves no organization; set it up whole so it has an owner.
  if (!existing) {
    await installOrganization(deps, installation, source);
    return true;
  }
  await database.transaction(async (tx) => {
    await followRename(deps, tx, installation, source);
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

async function onOrganizationRenamed(
  deps: GithubWebhookDeps,
  organization: z.infer<typeof payloadOrganizationSchema>,
): Promise<boolean> {
  const source = "organization.renamed";
  const renamed = await deps.database.transaction((tx) =>
    followRename(deps, tx, { accountId: organization.id, login: organization.login }, source),
  );
  if (!renamed) {
    deps.logger.info("organization.rename_skipped", {
      source,
      githubAccountId: organization.id,
      login: organization.login,
      reason: "unchanged_or_not_installed",
    });
  }
  return renamed;
}

// The payload's role is not trusted: GitHub is asked for the current one, so reordered deliveries converge.
async function onMemberChanged(
  deps: GithubWebhookDeps,
  event: string,
  action: string,
  payloadOrganization: z.infer<typeof payloadOrganizationSchema> | undefined,
  user: z.infer<typeof payloadUserSchema> | null | undefined,
  payloadRepository?: { id: number },
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
  const repo = payloadRepository && (await findRepoByGithubId(deps.database, payloadRepository.id));
  const tracked = repo && repo.organizationId === organization.id && !repo.removedAt;
  const permission =
    tracked && decision.action === "grant"
      ? await lookupRepoPermission(deps.github, organization, repo, account)
      : undefined;
  await deps.database.transaction(async (tx) => {
    const txDeps = { ...deps, database: tx };
    await applyMembership(txDeps, organization, { account, decision }, source);
    if (!tracked || permission === undefined) return;
    const { id: userId } = await upsertAccountUser(tx, account);
    await applyRepoAccess(txDeps, userId, account, { organization, repo, permission }, source);
  });
  return true;
}

// Every mode's actions of interest; anything else is skipped before the repo is even looked up.
const RELEVANT_ACTIONS = new Set(["opened", "labeled", "synchronize", "reopened"]);

function wantsReview(
  payload: z.infer<typeof pullRequestEventSchema>,
  mode: RepoReviewMode,
): boolean {
  if (payload.pull_request.state !== "open" || mode === "off") return false;
  if (mode === "every_pr") {
    return (
      payload.action === "opened" ||
      payload.action === "synchronize" ||
      payload.action === "reopened"
    );
  }
  switch (payload.action) {
    case "labeled":
      return payload.label?.name === REVIEW_LABEL;
    case "synchronize":
    case "reopened":
      return payload.pull_request.labels.some((label) => label.name === REVIEW_LABEL);
    default:
      return false;
  }
}

// Only records the job: the review itself runs in the worker, well outside GitHub's 10s window.
async function onPullRequest(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof pullRequestEventSchema>,
  deliveryId: string | null,
): Promise<boolean> {
  if (!RELEVANT_ACTIONS.has(payload.action)) return false;
  const pullRequest = payload.pull_request;
  const fields = {
    source: `pull_request.${payload.action}`,
    githubRepoId: payload.repository.id,
    prNumber: pullRequest.number,
    headSha: pullRequest.head.sha,
    deliveryId,
  };
  const repo = await findRepoByGithubId(deps.database, payload.repository.id);
  const organization = repo && (await findOrganizationById(deps.database, repo.organizationId));
  const skip = (reason: string) => {
    deps.logger.info("review_job.skipped", { ...fields, reason });
    return false;
  };
  if (!repo || repo.removedAt) return skip("repository_not_tracked");
  if (!organization || !installedAccount(organization)) return skip("organization_not_installed");
  if (organization.suspendedAt) return skip("installation_suspended");
  const settings = await effectiveRepoSettings(deps.database, repo.id);
  if (!wantsReview(payload, settings.mode)) return skip("review_not_requested");
  const result = await enqueueReviewJob(deps.database, {
    repoId: repo.id,
    prNumber: pullRequest.number,
    headSha: pullRequest.head.sha,
    deliveryId,
  });
  if (result.status === "duplicate") {
    deps.logger.info("review_job.duplicate", fields);
  } else {
    deps.logger.info("review_job.queued", {
      ...fields,
      jobId: result.job.id,
      superseded: result.superseded,
    });
    deps.pingWorker();
  }
  return true;
}

const REPOSITORY_ACTIONS = ["renamed", "privatized", "publicized", "transferred", "deleted"];

// Each action writes only its own field, so a late delivery of another action cannot undo it.
async function onRepository(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof repositoryEventSchema>,
): Promise<boolean> {
  const { action, repository } = payload;
  if (!REPOSITORY_ACTIONS.includes(action)) return false;
  const source = `repository.${action}`;
  const fields = { source, githubRepoId: repository.id, repo: `${repository.owner.login}/${repository.name}` };
  const existing = await findRepoByGithubId(deps.database, repository.id);
  const organization = existing && (await findOrganizationById(deps.database, existing.organizationId));
  if (!existing || !organization) {
    deps.logger.info("repository.skipped", { ...fields, reason: "repository_not_tracked" });
    return false;
  }
  const { database } = deps;

  switch (action) {
    case "renamed":
      await updateRepository(database, repository.id, {
        owner: repository.owner.login,
        name: repository.name,
      });
      break;
    case "publicized":
      await updateRepository(database, repository.id, { private: false });
      break;
    case "privatized": {
      const readers = await listReaders(deps, organization, repository, fields);
      await database.transaction(async (tx) => {
        await updateRepository(tx, repository.id, { private: true });
        if (readers) await replaceRepoAccess(tx, existing.id, readers);
      });
      break;
    }
    case "transferred":
      if (repository.owner.id === organization.githubAccountId) {
        await updateRepository(database, repository.id, {
          owner: repository.owner.login,
          name: repository.name,
        });
      } else {
        await removeRepository(database, repository.id);
      }
      break;
    case "deleted":
      await removeRepository(database, repository.id);
      break;
  }
  deps.logger.info("repository.updated", { ...fields, organization: organization.slug });
  return true;
}

// Undefined when GitHub cannot say; the repo is still made private, and stored rows stay.
async function listReaders(
  deps: GithubWebhookDeps,
  organization: Organization,
  repository: z.infer<typeof repositoryEventSchema>["repository"],
  fields: Record<string, unknown>,
): Promise<{ githubId: number; permission: RepoPermission }[] | undefined> {
  const installed = installedAccount(organization);
  if (!installed || organization.suspendedAt || installed.accountType === "user") return undefined;
  try {
    const listed = await deps.github.listRepositoryCollaborators(
      installed.installationId,
      repository.owner.login,
      repository.name,
    );
    return listed.map(({ id, permission }) => ({ githubId: id, permission }));
  } catch (error) {
    deps.logger.error("repo_access.skipped", {
      ...fields,
      organization: organization.slug,
      reason: "github_lookup_failed",
      error: errorMessage(error),
    });
    return undefined;
  }
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
