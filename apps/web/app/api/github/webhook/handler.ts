import { createHmac, timingSafeEqual } from "node:crypto";

import {
  effectiveRepoSettings,
  enqueueReviewJob,
  findOrganizationById,
  findRepoByGithubId,
  upsertWorkflowJob,
  upsertWorkflowRun,
  type InstallationInput,
  type Repo,
  type RepoReviewMode,
} from "@pr-review/db";
import { z } from "zod";

import { toInstallation, type InstallationDeps } from "@/lib/installation";
import { applyInstallationEvent, type RepositoryChange } from "@/lib/installation-lifecycle";
import { installedAccount } from "@/lib/membership-sync";
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
  repository: z.object({ id: z.number(), owner: payloadOrganizationSchema.optional() }).optional(),
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

const workflowRunEventSchema = z.object({
  action: z.string(),
  workflow_run: z.object({
    id: z.number(),
    run_attempt: z.number(),
    workflow_id: z.number(),
    name: z.string().nullish(),
    path: z.string(),
    event: z.string(),
    head_branch: z.string().nullish(),
    head_sha: z.string(),
    status: z.string(),
    conclusion: z.string().nullish(),
    created_at: z.string(),
    run_started_at: z.string().nullish(),
    updated_at: z.string(),
    html_url: z.string(),
    pull_requests: z.array(z.object({ number: z.number() })),
  }),
  repository: z.object({ id: z.number() }),
});

const workflowJobEventSchema = z.object({
  action: z.string(),
  workflow_job: z.object({
    id: z.number(),
    run_id: z.number(),
    run_attempt: z.number(),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullish(),
    started_at: z.string().nullish(),
    completed_at: z.string().nullish(),
    labels: z.array(z.string()),
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
            // A personal account's repo has no organization; its owner is the account.
            event === "member" ? (data.organization ?? data.repository?.owner) : data.organization,
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
    case "workflow_run":
      return (payload) =>
        withPayload(workflowRunEventSchema, payload, (data) => onWorkflowRun(deps, data));
    case "workflow_job":
      return (payload) =>
        withPayload(workflowJobEventSchema, payload, (data) => onWorkflowJob(deps, data));
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

const INSTALLATION_KINDS = {
  created: "installed",
  deleted: "uninstalled",
  suspend: "suspended",
  unsuspend: "unsuspended",
  new_permissions_accepted: "permissions_accepted",
} as const;

function onInstallation(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof installationEventSchema>,
): Promise<boolean> {
  const installation = fromPayload(payload.installation);
  const kind = Object.hasOwn(INSTALLATION_KINDS, payload.action)
    ? INSTALLATION_KINDS[payload.action as keyof typeof INSTALLATION_KINDS]
    : undefined;
  if (!installation || !kind) return Promise.resolve(false);
  return applyInstallationEvent(deps, {
    kind,
    installation,
    source: `installation.${payload.action}`,
  });
}

function onInstallationRepositories(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof installationRepositoriesEventSchema>,
): Promise<boolean> {
  const installation = fromPayload(payload.installation);
  if (!installation) return Promise.resolve(false);
  if (payload.action !== "added" && payload.action !== "removed") return Promise.resolve(false);
  return applyInstallationEvent(deps, {
    kind: "repositories_changed",
    installation,
    added: payload.repositories_added.map((repo) => ({
      githubRepoId: repo.id,
      owner: repo.full_name.split("/")[0] ?? installation.login,
      name: repo.name,
      private: repo.private,
    })),
    removed: payload.repositories_removed.map((repo) => repo.id),
    source: `installation_repositories.${payload.action}`,
  });
}

function onOrganizationRenamed(
  deps: GithubWebhookDeps,
  organization: z.infer<typeof payloadOrganizationSchema>,
): Promise<boolean> {
  return applyInstallationEvent(deps, {
    kind: "account_renamed",
    account: { accountId: organization.id, login: organization.login },
    source: "organization.renamed",
  });
}

function onMemberChanged(
  deps: GithubWebhookDeps,
  event: string,
  action: string,
  payloadOrganization: z.infer<typeof payloadOrganizationSchema> | undefined,
  user: z.infer<typeof payloadUserSchema> | null | undefined,
  payloadRepository?: { id: number },
): Promise<boolean> {
  if (!MEMBER_ACTIONS[event]?.includes(action) || !payloadOrganization || !user) {
    return Promise.resolve(false);
  }
  return applyInstallationEvent(deps, {
    kind: "member_changed",
    account: { accountId: payloadOrganization.id, login: payloadOrganization.login },
    user: { githubId: user.id, login: user.login, avatarUrl: user.avatar_url ?? null },
    githubRepoId: payloadRepository?.id,
    source: `${event}.${action}`,
  });
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

// Scheduled and hand-dispatched runs say nothing about a change's health.
const DROPPED_RUN_EVENTS = new Set(["schedule", "workflow_dispatch"]);

async function ciRepo(
  deps: GithubWebhookDeps,
  githubRepoId: number,
  skip: (reason: string) => false,
): Promise<Repo | false> {
  const repo = await findRepoByGithubId(deps.database, githubRepoId);
  if (!repo || repo.removedAt) return skip("repository_not_tracked");
  const organization = await findOrganizationById(deps.database, repo.organizationId);
  if (!organization || !installedAccount(organization)) return skip("organization_not_installed");
  const settings = await effectiveRepoSettings(deps.database, repo.id);
  if (!settings.ciInsights) return skip("ci_insights_off");
  return repo;
}

async function onWorkflowRun(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof workflowRunEventSchema>,
): Promise<boolean> {
  const run = payload.workflow_run;
  const fields = {
    source: `workflow_run.${payload.action}`,
    githubRepoId: payload.repository.id,
    githubRunId: run.id,
    runAttempt: run.run_attempt,
  };
  const skip = (reason: string) => {
    deps.logger.info("workflow_run.skipped", { ...fields, reason });
    return false as const;
  };
  if (DROPPED_RUN_EVENTS.has(run.event)) return skip("event_not_ingested");
  const repo = await ciRepo(deps, payload.repository.id, skip);
  if (!repo) return false;
  const stored = await upsertWorkflowRun(deps.database, repo.id, {
    githubRunId: run.id,
    runAttempt: run.run_attempt,
    workflowId: run.workflow_id,
    workflowName: run.name ?? run.path,
    event: run.event,
    headBranch: run.head_branch ?? null,
    headSha: run.head_sha,
    prNumber: run.pull_requests[0]?.number ?? null,
    status: run.status,
    conclusion: run.conclusion ?? null,
    runStartedAt: new Date(run.run_started_at ?? run.created_at),
    githubUpdatedAt: new Date(run.updated_at),
    htmlUrl: run.html_url,
  });
  deps.logger.info(stored ? "workflow_run.stored" : "workflow_run.stale", fields);
  return true;
}

async function onWorkflowJob(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof workflowJobEventSchema>,
): Promise<boolean> {
  const job = payload.workflow_job;
  const fields = {
    source: `workflow_job.${payload.action}`,
    githubRepoId: payload.repository.id,
    githubRunId: job.run_id,
    githubJobId: job.id,
  };
  const skip = (reason: string) => {
    deps.logger.info("workflow_job.skipped", { ...fields, reason });
    return false as const;
  };
  const repo = await ciRepo(deps, payload.repository.id, skip);
  if (!repo) return false;
  const result = await upsertWorkflowJob(deps.database, repo.id, {
    githubRunId: job.run_id,
    runAttempt: job.run_attempt,
    githubJobId: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion ?? null,
    startedAt: job.started_at ? new Date(job.started_at) : null,
    completedAt: job.completed_at ? new Date(job.completed_at) : null,
    runnerLabels: job.labels,
  });
  if (result === "run_not_ingested") return skip(result);
  deps.logger.info(`workflow_job.${result}`, fields);
  return true;
}

const REPOSITORY_ACTIONS: readonly string[] = [
  "renamed",
  "privatized",
  "publicized",
  "transferred",
  "deleted",
] satisfies RepositoryChange[];

function onRepository(
  deps: GithubWebhookDeps,
  payload: z.infer<typeof repositoryEventSchema>,
): Promise<boolean> {
  const { action, repository } = payload;
  if (!REPOSITORY_ACTIONS.includes(action)) return Promise.resolve(false);
  return applyInstallationEvent(deps, {
    kind: "repository_changed",
    change: action as RepositoryChange,
    repository: {
      githubRepoId: repository.id,
      owner: { accountId: repository.owner.id, login: repository.owner.login },
      name: repository.name,
    },
    source: `repository.${action}`,
  });
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
