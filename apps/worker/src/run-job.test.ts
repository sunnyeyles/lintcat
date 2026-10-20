import { randomBytes } from "node:crypto";

import type { LanguageModelConfig, ReviewModel } from "@pr-review/ai";
import { CHECK_RUN_NAME } from "@pr-review/github";
import { FIX_COMMIT_MARKER } from "@pr-review/reviewer";
import {
  finalFindingsJson,
  headSha,
  makeFinding,
  makeGithub,
  makeHangingModel,
  makeModel,
  message,
  pullRequest,
  textBlock,
} from "@pr-review/ai/agent-test-support";
import {
  claimReviewJob,
  completeReviewJob,
  enqueueReviewJob,
  findings,
  markUninstalled,
  modelKeys,
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
import { reviewRecordRiskSchema } from "@pr-review/schemas";
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

function answering(findings = [makeFinding("naming", { line: 41 })]): ReviewModel {
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
    withWriteDatabase: (run) => run(database),
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

  it.each([
    ["succeeds", () => answering(), "succeeded"],
    [
      "fails",
      () => {
        const failing = makeModel([]).model;
        failing.doGenerate = async () => {
          throw new Error("overloaded");
        };
        return failing;
      },
      "retrying",
    ],
  ] as const)("masks the token and key in traces until a job that %s settles", async (_, model, outcome) => {
    await withKey();
    const job = await claim();
    let registered: readonly (string | undefined)[] = [];
    const untrace = vi.fn();
    const traceSecrets = vi.fn((secrets: readonly (string | undefined)[]) => {
      registered = secrets;
      return untrace;
    });
    const { deps: d } = deps({ createLanguageModel: model, traceSecrets });

    expect(await runReviewJob(d, job)).toBe(outcome);

    expect(traceSecrets).toHaveBeenCalledOnce();
    expect(registered).toEqual(expect.arrayContaining([TOKEN, API_KEY]));
    expect(untrace).toHaveBeenCalledOnce();
  });

  it("AC16: shows the final failure on a neutral check run once the retries run out", async () => {
    await withKey();
    const job = await claim();
    const { deps: d } = deps({
      createLanguageModel: () => makeModel([]).model,
      retry: { maxAttempts: 1, retryDelayMs: 0 },
    });

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(github.createReview).not.toHaveBeenCalled();
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ headSha, conclusion: "neutral" }),
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
      expect.objectContaining({ modelId: "claude-sonnet-5" }),
    );
  });

  it("reviews only the commits since the last reviewed one by default", async () => {
    await withKey();
    github.listPullRequestCommitShas.mockResolvedValue(["old111", headSha]);
    github.listCheckRuns.mockResolvedValue([{ name: CHECK_RUN_NAME, status: "completed" }]);
    const job = await claim();
    const { deps: d } = deps();

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.compareCommits).toHaveBeenCalledWith(
      expect.objectContaining({ base: "old111", head: headSha }),
    );
  });

  it("reviews the whole pull request when incremental review is switched off", async () => {
    await withKey();
    github.listPullRequestCommitShas.mockResolvedValue(["old111", headSha]);
    github.listCheckRuns.mockResolvedValue([{ name: CHECK_RUN_NAME, status: "completed" }]);
    const job = await claim();
    const { deps: d } = deps({ incremental: false });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.compareCommits).not.toHaveBeenCalled();
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

  it("AC16: fails without a retry and with a clear neutral check run message on an unknown model", async () => {
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
    expect(github.createCheckRun).toHaveBeenCalledOnce();
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: "neutral" }),
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
    const finding = makeFinding("naming", {
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

  it("never commits a fix on top of its own fix commit", async () => {
    await withKey();
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: true });
    const job = await claim();
    github.getFileContents.mockResolvedValue(FILE);
    github.getCommitMessage.mockResolvedValue(`Apply fixes\n\n${FIX_COMMIT_MARKER}`);
    const { deps: d } = deps({ createLanguageModel: () => answeringWithFix() });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.createCommitOnBranch).not.toHaveBeenCalled();
    expect(github.createReview).toHaveBeenCalledOnce();
  });

  it("commits no fix when the head commit cannot be read", async () => {
    await withKey();
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: true });
    const job = await claim();
    github.getFileContents.mockResolvedValue(FILE);
    github.getCommitMessage.mockRejectedValue(new Error("boom"));
    const { deps: d } = deps({ createLanguageModel: () => answeringWithFix() });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.createCommitOnBranch).not.toHaveBeenCalled();
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
    const finding = makeFinding("naming", {
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

  it("replaces the review's findings when the same commit is reviewed again", async () => {
    await withKey();
    const first = [makeFinding("naming", { line: 41, title: "First problem" })];
    const { deps: d1 } = deps({ createLanguageModel: () => answering(first) });
    expect(await runReviewJob(d1, await claim())).toBe("succeeded");
    expect(await database.select().from(findings)).toMatchObject([{ title: "First problem" }]);

    const rerun = [makeFinding("naming", { line: 41, title: "Only problem left" })];
    const { deps: d2 } = deps({ createLanguageModel: () => answering(rerun) });
    expect(await runReviewJob(d2, await claim())).toBe("succeeded");

    const stored = await database.select().from(reviews);
    expect(stored).toMatchObject([{ repoId, prNumber: 42, headSha }]);
    expect(await database.select().from(findings)).toMatchObject([
      { reviewId: stored[0]!.id, title: "Only problem left" },
    ]);
  });

  it("records the blast radius it scored, as paths and numbers the ingest schema accepts", async () => {
    await withKey();
    const { deps: d } = deps();

    expect(await runReviewJob(d, await claim())).toBe("succeeded");

    const [stored] = await database.select().from(reviews);
    expect(stored?.risk).toMatchObject({
      band: expect.stringMatching(/^(low|medium|high)$/),
      partial: false,
      hubs: [{ path: "src/sessions.ts", dependents: 3 }],
      counts: expect.objectContaining({ direct: 3, transitive: 3 }),
      packages: 0,
      dependents: ["src/admin.ts", "src/api.ts", "src/boot.ts"],
    });
    expect(reviewRecordRiskSchema.safeParse(stored?.risk).success).toBe(true);
    const text = JSON.stringify(stored?.risk);
    expect(text).not.toContain("createSession");
    expect(text).not.toContain("export const");
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

describe("runReviewJob fencing by the claimed attempt", () => {
  // Worker B reclaims the only row after worker A's lease lapsed.
  async function reclaim(job: ReviewJob): Promise<ReviewJob> {
    await database.update(reviewJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) });
    const workerB = await claimReviewJob(database, { leaseMs: 60_000 });
    if (!workerB || workerB.id !== job.id) throw new Error("reclaim failed");
    return workerB;
  }

  const FILE = Array.from({ length: 41 }, (_, i) =>
    i === 40 ? "const target = 1;" : `line ${i + 1}`,
  ).join("\n");

  function answeringWithFix(): ReviewModel {
    const finding = makeFinding("naming", {
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

  function expectNothingPublished() {
    expect(github.createReview).not.toHaveBeenCalled();
    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(github.createCommitOnBranch).not.toHaveBeenCalled();
    expect(github.writeFileOnBranch).not.toHaveBeenCalled();
  }

  it("AC3: publishes nothing and returns superseded when the job is reclaimed just before publishing", async () => {
    await withKey();
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: true });
    github.getFileContents.mockResolvedValue(FILE);
    const job = await claim();
    let workerB: ReviewJob | undefined;
    github.listReviewComments.mockImplementation(async () => {
      workerB = await reclaim(job);
      return [];
    });
    const { deps: d } = deps({ createLanguageModel: () => answeringWithFix() });

    expect(await runReviewJob(d, job)).toBe("superseded");

    expect(workerB).toBeDefined();
    expectNothingPublished();
    expect(await database.select().from(reviews)).toEqual([]);
    expect(await database.select().from(findings)).toEqual([]);
    expect(await status(job.id)).toMatchObject({
      status: "running",
      attempts: workerB!.attempts,
      leaseExpiresAt: workerB!.leaseExpiresAt,
    });
  });

  it(
    "AC3: a stale heartbeat aborts a review that was reclaimed mid-review, posting nothing",
    async () => {
      await withKey();
      const job = await claim();
      const hanging = makeHangingModel();
      const { deps: d } = deps({
        createLanguageModel: () => hanging.model,
        lease: { leaseMs: 60_000, heartbeatMs: 5 },
      });

      const run = runReviewJob(d, job);
      await hanging.firstCall;
      const workerB = await reclaim(job);

      expect(await run).toBe("superseded");
      expectNothingPublished();
      expect(await database.select().from(reviews)).toEqual([]);
      expect(await status(job.id)).toMatchObject({ status: "running", attempts: workerB.attempts });
    },
    20_000,
  );

  it("AC2: a stale worker on the not-installed path leaves the reclaimed row alone", async () => {
    await withKey();
    const job = await claim();
    const workerB = await reclaim(job);
    await markUninstalled(database, 1);
    const { deps: d } = deps();

    await runReviewJob(d, job);

    expect(await status(job.id)).toMatchObject({
      status: "running",
      attempts: workerB.attempts,
      leaseExpiresAt: workerB.leaseExpiresAt,
      lastError: null,
    });
  });

  it("AC2: a stale worker that finds the head moved does not supersede the reclaimed row", async () => {
    await withKey();
    // Mode off skips head repair, whose enqueue would rightly supersede the row.
    await saveRepoSettings(database, repoId, { mode: "off", model: null, fixes: false });
    const job = await claim("0".repeat(40));
    const workerB = await reclaim(job);
    const { deps: d } = deps();

    await runReviewJob(d, job);

    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({
      status: "running",
      attempts: workerB.attempts,
      leaseExpiresAt: workerB.leaseExpiresAt,
    });
  });

  it("AC2: a stale worker whose review fails neither requeues nor fails the reclaimed row", async () => {
    await withKey();
    const job = await claim();
    const failing = makeModel([]).model;
    let workerB: ReviewJob | undefined;
    failing.doGenerate = async () => {
      workerB = await reclaim(job);
      throw new Error("overloaded");
    };
    const { deps: d } = deps({
      createLanguageModel: () => failing,
      retry: { maxAttempts: 1, retryDelayMs: 0 },
    });

    expect(await runReviewJob(d, job)).toBe("superseded");

    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({
      status: "running",
      attempts: workerB!.attempts,
      lastError: null,
    });
  });
});

describe("runReviewJob recording through the write database", () => {
  it("records the review through withWriteDatabase", async () => {
    await withKey();
    const job = await claim();
    const withWriteDatabase = vi.fn(<T,>(run: (db: Database) => Promise<T>) => run(database));
    const { deps: d } = deps({ withWriteDatabase });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(withWriteDatabase).toHaveBeenCalled();
    expect(await database.select().from(reviews)).toMatchObject([{ repoId, prNumber: 42, headSha }]);
  });

  it("AC15: still publishes the GitHub review and succeeds when the write-database runner rejects", async () => {
    await withKey();
    const job = await claim();
    const { deps: d } = deps({
      withWriteDatabase: async () => {
        throw new Error("could not open the write pool");
      },
    });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.createReview).toHaveBeenCalledOnce();
    expect(await status(job.id)).toMatchObject({ status: "succeeded" });
    expect(await database.select().from(reviews)).toEqual([]);
  });

  it("AC15: still publishes the GitHub review and succeeds when ingest throws", async () => {
    await withKey();
    const job = await claim();
    // Every query on it throws, as a dropped connection would.
    const broken = new Proxy({} as Database, {
      get() {
        throw new Error("connection terminated");
      },
    });
    const { deps: d } = deps({ withWriteDatabase: (run) => run(broken) });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(github.createReview).toHaveBeenCalledOnce();
    expect(await status(job.id)).toMatchObject({ status: "succeeded" });
    expect(await database.select().from(reviews)).toEqual([]);
  });
});

describe("runReviewJob on a closed pull request", () => {
  function expectNothingPosted() {
    expect(github.createReview).not.toHaveBeenCalled();
    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(github.createCommitOnBranch).not.toHaveBeenCalled();
    expect(github.writeFileOnBranch).not.toHaveBeenCalled();
  }

  it.each(["closed", "merged"])(
    "AC10: a job whose pull request was %s ends superseded with reason pr_closed, creating no model and posting nothing",
    async () => {
      await withKey();
      const job = await claim();
      github.getPullRequest.mockResolvedValue({ ...pullRequest, state: "closed" });
      const { deps: d, createLanguageModel } = deps();

      expect(await runReviewJob(d, job)).toBe("superseded");

      expect(createLanguageModel).not.toHaveBeenCalled();
      expectNothingPosted();
      expect(await status(job.id)).toMatchObject({ status: "superseded", leaseExpiresAt: null });
      expect(log).toContainEqual(
        expect.objectContaining({ event: "review_job.superseded", reason: "pr_closed" }),
      );
      expect(await database.select().from(reviews)).toEqual([]);
    },
  );

  it("AC10: a closed pull request whose head also moved is not re-enqueued", async () => {
    await withKey();
    const job = await claim();
    github.getPullRequest.mockResolvedValue({ ...pullRequest, headSha: "f".repeat(40), state: "closed" });
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("superseded");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expectNothingPosted();
    const rows = await database.select().from(reviewJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: job.id, status: "superseded" });
    expect(log).toContainEqual(
      expect.objectContaining({ event: "review_job.superseded", reason: "pr_closed" }),
    );
  });
});

describe("runReviewJob head repair", () => {
  const H1 = "1".repeat(40);
  const H2 = "2".repeat(40);

  function liveHead(sha: string, labels: string[] = []) {
    github.getPullRequest.mockResolvedValue({ ...pullRequest, headSha: sha, labels });
  }

  async function enqueue(sha: string) {
    return enqueueReviewJob(database, { repoId, prNumber: 42, headSha: sha, deliveryId: `d-${++deliveries}` });
  }

  async function claimNext(): Promise<ReviewJob> {
    const job = await claimReviewJob(database, { leaseMs: 60_000 });
    if (!job) throw new Error("nothing to claim");
    return job;
  }

  async function jobsFor(sha: string) {
    return (await database.select().from(reviewJobs)).filter((row) => row.headSha === sha);
  }

  // H2's webhook is enqueued first, then H1's supersedes it.
  async function outOfOrder(): Promise<ReviewJob> {
    await enqueue(H2);
    await enqueue(H1);
    const job = await claimNext();
    expect(job.headSha).toBe(H1);
    expect(await jobsFor(H2)).toMatchObject([{ status: "superseded" }]);
    return job;
  }

  function expectNoReview(createLanguageModel: ReturnType<typeof vi.fn>) {
    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(github.createReview).not.toHaveBeenCalled();
    expect(github.createCheckRun).not.toHaveBeenCalled();
  }

  it("AC7: re-enqueues the live head H2 when H1's job finds the head moved, and supersedes H1", async () => {
    await withKey();
    const job = await outOfOrder();
    liveHead(H2);
    const withWriteDatabase = vi.fn(<T,>(run: (db: Database) => Promise<T>) => run(database));
    const { deps: d, createLanguageModel } = deps({ withWriteDatabase });

    expect(await runReviewJob(d, job)).toBe("superseded");

    expectNoReview(createLanguageModel);
    expect(withWriteDatabase).toHaveBeenCalled();
    const h1 = await jobsFor(H1);
    expect(h1).toMatchObject([{ id: job.id, status: "superseded", leaseExpiresAt: null }]);
    const active = (await jobsFor(H2)).filter((row) => row.status === "queued" || row.status === "running");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ repoId, prNumber: 42, status: "queued", deliveryId: null });
  });

  it("AC7: the re-enqueued H2 job is the next one claimed", async () => {
    await withKey();
    const job = await outOfOrder();
    liveHead(H2);

    await runReviewJob(deps().deps, job);

    expect(await claimReviewJob(database, { leaseMs: 60_000 })).toMatchObject({ headSha: H2, prNumber: 42 });
  });

  it("AC8: enqueues nothing when a job for the live head has already succeeded", async () => {
    await withKey();
    await enqueue(H2);
    await completeReviewJob(database, await claimNext());
    await enqueue(H1);
    const job = await claimNext();
    liveHead(H2);
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("superseded");

    expectNoReview(createLanguageModel);
    expect(await jobsFor(H2)).toMatchObject([{ status: "succeeded" }]);
    expect(await jobsFor(H1)).toMatchObject([{ id: job.id, status: "superseded" }]);
  });

  it.each(["queued", "running"] as const)(
    "AC8: enqueues nothing when a job for the live head is already %s",
    async (activeStatus) => {
      await withKey();
      await enqueue(H1);
      const job = await claimNext();
      // Inserted directly: enqueueing H2 would supersede the running H1 job.
      const [h2] = await database
        .insert(reviewJobs)
        .values({ repoId, prNumber: 42, headSha: H2, deliveryId: "h2", status: activeStatus })
        .returning();
      liveHead(H2);
      const { deps: d, createLanguageModel } = deps();

      expect(await runReviewJob(d, job)).toBe("superseded");

      expectNoReview(createLanguageModel);
      expect(await jobsFor(H2)).toMatchObject([{ id: h2!.id, status: activeStatus }]);
      expect(await jobsFor(H1)).toMatchObject([{ id: job.id, status: "superseded" }]);
    },
  );

  it("AC9: enqueues nothing when the repo's mode is now off", async () => {
    await withKey();
    const job = await outOfOrder();
    await saveRepoSettings(database, repoId, { mode: "off", model: null, fixes: false });
    liveHead(H2, ["ai-review"]);
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("superseded");

    expectNoReview(createLanguageModel);
    expect(await jobsFor(H2)).toMatchObject([{ status: "superseded" }]);
    expect(await jobsFor(H1)).toMatchObject([{ id: job.id, status: "superseded" }]);
  });

  it("AC9: enqueues nothing in label mode when the pull request lacks the ai-review label", async () => {
    await withKey();
    const job = await outOfOrder();
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: false });
    liveHead(H2, ["bug"]);
    const { deps: d, createLanguageModel } = deps();

    expect(await runReviewJob(d, job)).toBe("superseded");

    expectNoReview(createLanguageModel);
    expect(await jobsFor(H2)).toMatchObject([{ status: "superseded" }]);
    expect(await jobsFor(H1)).toMatchObject([{ id: job.id, status: "superseded" }]);
  });

  it("AC9: still enqueues the live head in label mode when the pull request has the ai-review label", async () => {
    await withKey();
    const job = await outOfOrder();
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: false });
    liveHead(H2, ["ai-review"]);
    const { deps: d } = deps();

    expect(await runReviewJob(d, job)).toBe("superseded");

    const active = (await jobsFor(H2)).filter((row) => row.status === "queued");
    expect(active).toMatchObject([{ deliveryId: null }]);
    expect(await jobsFor(H1)).toMatchObject([{ id: job.id, status: "superseded" }]);
  });
});

describe("runReviewJob attempt limit", () => {
  const retry = { maxAttempts: 2, retryDelayMs: 0 };

  async function lapseAndReclaim(job: ReviewJob): Promise<ReviewJob> {
    await database.update(reviewJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) });
    const next = await claimReviewJob(database, { leaseMs: 60_000 });
    if (!next || next.id !== job.id) throw new Error("reclaim failed");
    return next;
  }

  // Each claim's worker crashed and its lease lapsed, until the claim exceeds the limit.
  async function overLimit(sha = headSha): Promise<ReviewJob> {
    let job = await claim(sha);
    while (job.attempts <= retry.maxAttempts) job = await lapseAndReclaim(job);
    expect(job.attempts).toBe(retry.maxAttempts + 1);
    return job;
  }

  function checkRuns() {
    const calls = github.createCheckRun.mock.calls as unknown as [
      { headSha: string; conclusion: string; output: { title: string; summary: string } },
    ][];
    return calls.map(([input]) => input);
  }

  it("AC4: a job reclaimed past its final allowed attempt fails without a model and posts one neutral check run", async () => {
    await withKey();
    const job = await overLimit();
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(github.createReview).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({
      status: "failed",
      lastError: "stopped without finishing on every attempt",
      leaseExpiresAt: null,
    });
    expect(log).toContainEqual(expect.objectContaining({ event: "review_job.attempts_exhausted" }));
    const runs = checkRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      owner: "octo-org",
      repo: "example-service",
      headSha,
      conclusion: "neutral",
      output: { title: "The AI review could not finish" },
    });
    const summary = runs[0]!.output.summary;
    expect(summary).toMatch(/stopped without finishing on every attempt/i);
    expect(summary).toMatch(/push a commit/i);
    expect(summary).toContain("ai-review");
    expect(await database.select().from(reviews)).toEqual([]);
  });

  it("AC4: the job is not requeued after the attempt limit, so nothing is left to claim", async () => {
    await withKey();
    const job = await overLimit();

    expect(await runReviewJob(deps({ retry }).deps, job)).toBe("failed");

    await database.update(reviewJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) });
    expect(await claimReviewJob(database, { leaseMs: 60_000 })).toBeUndefined();
  });

  it("AC4: still ends failed when posting the attempt-limit check run fails, keeping secrets out of the log", async () => {
    await withKey();
    const job = await overLimit();
    github.createCheckRun.mockRejectedValue(new Error(`GitHub said no to ${TOKEN}`));
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({
      status: "failed",
      lastError: "stopped without finishing on every attempt",
    });
    expectNoSecretsLogged();
  });

  it("AC4: also stops a job past its limit when the org has no model key, without the no-key check run", async () => {
    const job = await overLimit();
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(createLanguageModel).not.toHaveBeenCalled();
    const runs = checkRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ conclusion: "neutral", output: { title: "The AI review could not finish" } });
  });

  it("AC5: a job reclaimed after a lapsed lease on its final allowed attempt runs normally", async () => {
    await withKey();
    const job = await lapseAndReclaim(await claim());
    expect(job.attempts).toBe(retry.maxAttempts);
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("succeeded");

    expect(createLanguageModel).toHaveBeenCalledOnce();
    expect(github.createReview).toHaveBeenCalledOnce();
    expect(await status(job.id)).toMatchObject({ status: "succeeded" });
    expect(log).not.toContainEqual(expect.objectContaining({ event: "review_job.attempts_exhausted" }));
  });

  it("AC5: a first claim at attempts 1 runs normally", async () => {
    await withKey();
    const job = await claim();
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("succeeded");
    expect(createLanguageModel).toHaveBeenCalledOnce();
  });

  it("AC6: a job past its limit whose pull request is closed ends superseded and posts no check run", async () => {
    await withKey();
    const job = await overLimit();
    github.getPullRequest.mockResolvedValue({ ...pullRequest, state: "closed" });
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("superseded");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(await status(job.id)).toMatchObject({ status: "superseded" });
    expect(log).toContainEqual(
      expect.objectContaining({ event: "review_job.superseded", reason: "pr_closed" }),
    );
    expect(log).not.toContainEqual(expect.objectContaining({ event: "review_job.attempts_exhausted" }));
  });

  it("AC6: a job past its limit whose head moved ends superseded and posts no check run", async () => {
    await withKey();
    const job = await overLimit("0".repeat(40));
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("superseded");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(github.createCheckRun).not.toHaveBeenCalled();
    const rows = await database.select().from(reviewJobs);
    expect(rows.find((row) => row.id === job.id)).toMatchObject({ status: "superseded" });
    expect(log).toContainEqual(
      expect.objectContaining({ event: "review_job.superseded", reason: "head_moved" }),
    );
    expect(log).not.toContainEqual(expect.objectContaining({ event: "review_job.attempts_exhausted" }));
  });

  it("AC16: the attempt-limit check run is neutral", async () => {
    await withKey();
    const job = await overLimit();

    expect(await runReviewJob(deps({ retry }).deps, job)).toBe("failed");

    expect(checkRuns()).toMatchObject([
      { conclusion: "neutral", output: { title: "The AI review could not finish" } },
    ]);
  });

  it("AC16: the no-key check run is neutral", async () => {
    const job = await claim();

    expect(await runReviewJob(deps({ retry }).deps, job)).toBe("no-key");

    expect(checkRuns().map((run) => run.conclusion)).toEqual(["neutral"]);
  });
});

describe("runReviewJob unreadable model key", () => {
  const retry = { maxAttempts: 3, retryDelayMs: 0 };

  function checkRuns() {
    const calls = github.createCheckRun.mock.calls as unknown as [
      { owner: string; repo: string; headSha: string; conclusion: string; output: { title: string; summary: string } },
    ][];
    return calls.map(([input]) => input);
  }

  async function expectFailedOnce(jobId: number) {
    expect(await status(jobId)).toMatchObject({ status: "failed", attempts: 1, leaseExpiresAt: null });
    await database.update(reviewJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) });
    expect(await claimReviewJob(database, { leaseMs: 60_000 })).toBeUndefined();
  }

  it("AC17: a key sealed under a rotated encryption key fails on the first attempt without retrying", async () => {
    await withKey();
    const job = await claim();
    expect(job.attempts).toBe(1);
    const { deps: d, createLanguageModel } = deps({ retry, encryptionKey: randomBytes(32) });

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(github.createReview).not.toHaveBeenCalled();
    await expectFailedOnce(job.id);
    expect(log).not.toContainEqual(expect.objectContaining({ event: "review_job.retrying" }));
    expectNoSecretsLogged();
  });

  it("AC17: logs review_job.model_key_unreadable", async () => {
    await withKey();
    const job = await claim();

    await runReviewJob(deps({ retry, encryptionKey: randomBytes(32) }).deps, job);

    expect(log).toContainEqual(
      expect.objectContaining({ event: "review_job.model_key_unreadable", jobId: job.id }),
    );
  });

  it("AC17: posts one neutral check run telling an owner to re-add the key, with the settings link", async () => {
    await withKey();
    const job = await claim();

    expect(await runReviewJob(deps({ retry, encryptionKey: randomBytes(32) }).deps, job)).toBe("failed");

    const runs = checkRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      owner: "octo-org",
      repo: "example-service",
      headSha,
      conclusion: "neutral",
    });
    expect(runs[0]!.output.title).toMatch(/model key/i);
    expect(runs[0]!.output.summary).toContain("Settings → Model key");
    expect(runs[0]!.output.summary).toContain("https://octo-org.example.test/settings");
    expect(runs[0]!.output.summary).not.toContain(API_KEY);
  });

  it("AC17: leaves the link out of the check run when settingsUrl returns undefined", async () => {
    await withKey();
    const job = await claim();
    const { deps: d } = deps({ retry, encryptionKey: randomBytes(32), settingsUrl: () => undefined });

    expect(await runReviewJob(d, job)).toBe("failed");

    const runs = checkRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.conclusion).toBe("neutral");
    expect(runs[0]!.output.summary).toContain("Settings → Model key");
    expect(runs[0]!.output.summary).not.toMatch(/https?:\/\//);
    expect(runs[0]!.output.summary).not.toContain("undefined");
  });

  it("AC17: an unknown sealed format fails once the same way", async () => {
    await withKey();
    await database.update(modelKeys).set({ sealedKey: Buffer.from([9, 1, 2, 3]) });
    const job = await claim();
    const { deps: d, createLanguageModel } = deps({ retry });

    expect(await runReviewJob(d, job)).toBe("failed");

    expect(createLanguageModel).not.toHaveBeenCalled();
    await expectFailedOnce(job.id);
    expect(log).toContainEqual(expect.objectContaining({ event: "review_job.model_key_unreadable" }));
    expect(checkRuns()).toMatchObject([{ conclusion: "neutral" }]);
  });

  it("AC16: the unreadable-key check run is neutral", async () => {
    await withKey();
    const job = await claim();

    await runReviewJob(deps({ retry, encryptionKey: randomBytes(32) }).deps, job);

    expect(checkRuns().map((run) => run.conclusion)).toEqual(["neutral"]);
  });
});
