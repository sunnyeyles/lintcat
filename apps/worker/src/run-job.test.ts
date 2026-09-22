import { randomBytes } from "node:crypto";

import type { LanguageModelConfig, ReviewModel } from "@pr-review/ai";
import {
  finalFindingsJson,
  headSha,
  makeFinding,
  makeGithub,
  makeHangingModel,
  makeModel,
  message,
  textBlock,
} from "@pr-review/ai/agent-test-support";
import {
  claimReviewJob,
  enqueueReviewJob,
  findings,
  markUninstalled,
  organizations,
  repos,
  reviewJobs,
  reviews,
  saveModelKey,
  saveRepoSettings,
  type Database,
  type ReviewJob,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runReviewJob, type JobRunnerDeps } from "#src/run-job";

const INSTALLATION_ID = 555;
const API_KEY = "sk-ant-api03-very-secret-key-9f3a";
const TOKEN = "ghs_installation_token_1234";
const encryptionKey = randomBytes(32);

let database: Database;
let organizationId: number;
let repoId: number;
let github: ReturnType<typeof makeGithub>;
let log: CapturedLogEvent[];
let deliveries = 0;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({
      githubAccountId: 1,
      accountType: "organization",
      slug: "octo-org",
      name: "octo-org",
      installationId: INSTALLATION_ID,
    })
    .returning();
  organizationId = organization!.id;
  const [repo] = await database
    .insert(repos)
    .values({ organizationId, githubRepoId: 99, owner: "octo-org", name: "example-service" })
    .returning();
  repoId = repo!.id;
  github = makeGithub();
  github.listChangedFiles.mockResolvedValue([
    {
      filename: "src/sessions.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -40,2 +40,3 @@\n const a = 1;\n+if ((user.isAdmin = true)) {\n const b = 2;",
    },
  ]);
  log = [];
});

function answering(findings = [makeFinding("general", { line: 41 })]): ReviewModel {
  return makeModel([message([textBlock(finalFindingsJson(findings))], "end_turn")]).model;
}

function deps(overrides: Partial<JobRunnerDeps> = {}) {
  const capturing = createCapturingLogger();
  log = capturing.entries;
  const createInstallationToken = vi.fn(async () => TOKEN);
  const createClient = vi.fn((_token: string) => github);
  const createLanguageModel = vi.fn((_config: LanguageModelConfig) => answering());
  const built: JobRunnerDeps = {
    database,
    github: { createInstallationToken },
    createClient,
    createLanguageModel,
    encryptionKey,
    logger: capturing.logger,
    settingsUrl: (slug) => `https://${slug}.example.test/settings`,
    lease: { leaseMs: 60_000, heartbeatMs: 60_000 },
    retry: { maxAttempts: 3, retryDelayMs: 0 },
    ...overrides,
  };
  return { deps: built, createInstallationToken, createClient, createLanguageModel };
}

async function claim(sha = headSha): Promise<ReviewJob> {
  await enqueueReviewJob(database, {
    repoId,
    prNumber: 42,
    headSha: sha,
    deliveryId: `d-${++deliveries}`,
  });
  const job = await claimReviewJob(database, { leaseMs: 60_000 });
  if (!job) throw new Error("nothing to claim");
  return job;
}

async function status(jobId: number) {
  const [row] = await database.select().from(reviewJobs);
  expect(row!.id).toBe(jobId);
  return row!;
}

function withKey(provider = "anthropic") {
  return saveModelKey(database, organizationId, { provider, apiKey: API_KEY }, encryptionKey);
}

function expectNoSecretsLogged() {
  const text = JSON.stringify(log);
  expect(text).not.toContain(API_KEY);
  expect(text).not.toContain(TOKEN);
}

describe("runReviewJob", () => {
  it("reviews with the organization's key and publishes through the installation", async () => {
    await withKey();
    const job = await claim();
    const { deps: d, createInstallationToken, createClient, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(createInstallationToken).toHaveBeenCalledWith(INSTALLATION_ID);
    expect(createClient).toHaveBeenCalledWith(TOKEN);
    expect(createLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", apiKey: API_KEY }),
    );
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "octo-org", repo: "example-service", headSha }),
    );
    expect(github.createReview).toHaveBeenCalledOnce();
    expect(await status(job.id)).toMatchObject({ status: "succeeded", leaseExpiresAt: null });
    expect(await database.select().from(reviews)).toMatchObject([
      { repoId, prNumber: 42, headSha, summary: "1 finding" },
    ]);
    expectNoSecretsLogged();
  });

  it("mints a new installation token for every job", async () => {
    await withKey();
    const { deps: d, createInstallationToken } = deps();
    await runReviewJob(d, await claim());
    await runReviewJob(d, await claim("f".repeat(40)));
    expect(createInstallationToken).toHaveBeenCalledTimes(2);
  });

  it("without a key, publishes a neutral check run asking for one and calls no model", async () => {
    const job = await claim();
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("no-key");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(github.createReview).not.toHaveBeenCalled();
    expect(github.createCheckRun).toHaveBeenCalledOnce();
    const [input] = github.createCheckRun.mock.calls[0] as unknown as [
      { conclusion: string; output: { title: string; summary: string } },
    ];
    expect(input.conclusion).toBe("neutral");
    expect(input.output.title).toMatch(/model key/i);
    expect(input.output.summary).toContain("https://octo-org.example.test/settings");
    expect(await status(job.id)).toMatchObject({ status: "succeeded" });
  });

  it("publishes nothing when a newer push supersedes the job mid-review", async () => {
    await withKey();
    const job = await claim();
    const hanging = makeHangingModel();
    const { deps: d } = deps({
      createLanguageModel: () => hanging.model,
      lease: { leaseMs: 60_000, heartbeatMs: 5 },
    });

    const run = runReviewJob(d, job);
    await hanging.firstCall;
    await enqueueReviewJob(database, { repoId, prNumber: 42, headSha: "newer", deliveryId: "push" });

    expect(await run).toBe("superseded");
    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(github.createReview).not.toHaveBeenCalled();
    expect(await database.select().from(reviews)).toEqual([]);
  });

  it("publishes nothing when the job is superseded just before publishing", async () => {
    await withKey();
    const job = await claim();
    // Read on the way into publishing, after the last signal check.
    github.listReviewComments.mockImplementation(async () => {
      await enqueueReviewJob(database, { repoId, prNumber: 42, headSha: "newer", deliveryId: "late" });
      return [];
    });

    expect(await runReviewJob(deps().deps, job)).toBe("superseded");
    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(github.createReview).not.toHaveBeenCalled();
    expect(await database.select().from(reviews)).toEqual([]);
  });

  it("supersedes a job whose head GitHub has already moved past", async () => {
    await withKey();
    const job = await claim("0".repeat(40));
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("superseded");
    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({ status: "superseded" });
  });

  it("requeues a failed review, keeping the key out of the error and the logs", async () => {
    await withKey();
    const job = await claim();
    const leaky = makeModel([]).model;
    leaky.doGenerate = async () => {
      throw new Error(`401 invalid x-api-key ${API_KEY}`);
    };
    const { deps: d } = deps({ createLanguageModel: () => leaky });

    expect(await runReviewJob(d, job)).toBe("retrying");

    expect(github.createCheckRun).not.toHaveBeenCalled();
    const row = await status(job.id);
    expect(row.status).toBe("queued");
    expect(row.lastError).toContain("[redacted]");
    expect(row.lastError).not.toContain(API_KEY);
    expect(log).toContainEqual(expect.objectContaining({ event: "review_job.retrying" }));
    expectNoSecretsLogged();
  });

  it("shows the final failure on the check run once the retries run out", async () => {
    await withKey();
    const job = await claim();
    const { deps: d } = deps({
      createLanguageModel: () => makeModel([]).model,
      retry: { maxAttempts: 1, retryDelayMs: 0 },
    });

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(github.createReview).not.toHaveBeenCalled();
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ headSha, conclusion: "failure" }),
    );
    expect(await status(job.id)).toMatchObject({ status: "failed" });
  });

  it("retries when the installation token cannot be minted", async () => {
    await withKey();
    const job = await claim();
    const { deps: d } = deps({
      github: {
        createInstallationToken: async () => {
          throw new Error("GitHub is down");
        },
      },
    });

    expect(await runReviewJob(d, job)).toBe("retrying");
    expect(await status(job.id)).toMatchObject({ status: "queued", lastError: "GitHub is down" });
  });

  it("fails without a token once the organization has uninstalled the App", async () => {
    await withKey();
    const job = await claim();
    await markUninstalled(database, 1);
    const { deps: d, createInstallationToken } = deps();

    expect(await runReviewJob(d, job)).toBe("failed");
    expect(createInstallationToken).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({ status: "failed" });
  });
});

describe("runReviewJob repo settings", () => {
  it("calls the org key's default model with no repo override", async () => {
    await withKey();
    const job = await claim();
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(createLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "claude-haiku-4-5" }),
    );
  });

  it("uses the repo's chosen model id when one is saved", async () => {
    await withKey();
    await saveRepoSettings(database, repoId, {
      mode: "label",
      model: "claude-sonnet-4-5",
      fixes: false,
    });
    const job = await claim();
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(createLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "claude-sonnet-4-5" }),
    );
  });

  it("fails without a retry and with a clear check run message on an unknown model", async () => {
    await withKey();
    await saveRepoSettings(database, repoId, {
      mode: "label",
      model: "not-a-real-model",
      fixes: false,
    });
    const job = await claim();
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({ status: "failed" });
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: "failure" }),
    );
    const [input] = github.createCheckRun.mock.calls[0] as unknown as [
      { output: { title: string; summary: string } },
    ];
    expect(input.output.title).toMatch(/not recognized/i);
    expect(input.output.summary).toContain("not-a-real-model");
    expect(await database.select().from(reviews)).toEqual([]);
  });

  const FILE = Array.from({ length: 41 }, (_, i) =>
    i === 40 ? "const target = 1;" : `line ${i + 1}`,
  ).join("\n");

  function answeringWithFix(): ReviewModel {
    const finding = makeFinding("general", {
      line: 41,
      patch: {
        startLine: 41,
        endLine: 41,
        expected: "const target = 1;",
        replacement: "// patched\nconst target = 1;",
      },
    });
    return makeModel([message([textBlock(finalFindingsJson([finding]))], "end_turn")]).model;
  }

  it("commits a verified fix to the branch when the repository has fixes on", async () => {
    await withKey();
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: true });
    const job = await claim();
    github.getFileContents.mockResolvedValue(FILE);
    const { deps: d } = deps({ createLanguageModel: () => answeringWithFix() });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.createCommitOnBranch).toHaveBeenCalledOnce();
  });

  it("offers a verified fix as a suggestion, not a commit, with fixes off by default", async () => {
    await withKey();
    const job = await claim();
    github.getFileContents.mockResolvedValue(FILE);
    const { deps: d } = deps({ createLanguageModel: () => answeringWithFix() });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.createCommitOnBranch).not.toHaveBeenCalled();
    expect(github.createReview).toHaveBeenCalledOnce();
  });
});

describe("runReviewJob dashboard recording", () => {
  it("records findings without the patch's expected or replacement text", async () => {
    await withKey();
    const job = await claim();
    const finding = makeFinding("general", {
      line: 41,
      patch: {
        startLine: 41,
        endLine: 41,
        expected: "top secret expected text",
        replacement: "top secret replacement text",
      },
    });
    github.getFileContents.mockResolvedValue(
      Array.from({ length: 41 }, (_, i) =>
        i === 40 ? "top secret expected text" : `line ${i + 1}`,
      ).join("\n"),
    );
    const { deps: d } = deps({
      createLanguageModel: () =>
        makeModel([message([textBlock(finalFindingsJson([finding]))], "end_turn")]).model,
    });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    const stored = await database.select().from(findings);
    expect(stored).toHaveLength(1);
    const text = JSON.stringify(stored);
    expect(text).not.toContain("top secret expected text");
    expect(text).not.toContain("top secret replacement text");
  });

  it("does not record anything when the job fails", async () => {
    await withKey();
    const job = await claim();
    const { deps: d } = deps({
      createLanguageModel: () => makeModel([]).model,
      retry: { maxAttempts: 1, retryDelayMs: 0 },
    });

    expect(await runReviewJob(d, job)).toBe("failed");
    expect(await database.select().from(reviews)).toEqual([]);
  });
});
