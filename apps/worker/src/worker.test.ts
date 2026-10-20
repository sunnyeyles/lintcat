import { randomBytes } from "node:crypto";

import { makeGithub, makeModel } from "@pr-review/ai/agent-test-support";
import {
  enqueueReviewJob,
  organizations,
  repos,
  saveModelKey,
  type Database,
  type ReviewJob,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { createCapturingLogger } from "@pr-review/logging";
import { beforeEach, describe, expect, it } from "vitest";

import { runReviewJob, type JobRunnerDeps } from "#src/run-job";

import { runWorker } from "#src/worker";

let database: Database;
let organizationId: number;
let repoId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  organizationId = organization!.id;
  const [repo] = await database
    .insert(repos)
    .values({ organizationId: organization!.id, owner: "acme", name: "widgets" })
    .returning();
  repoId = repo!.id;
});

describe("runWorker", () => {
  it("drains the queue one job at a time, then stops when asked to run once", async () => {
    for (const prNumber of [1, 2]) {
      await enqueueReviewJob(database, { repoId, prNumber, headSha: "a", deliveryId: `d${prNumber}` });
    }
    const seen: number[] = [];
    const processed = await runWorker(
      {
        database,
        logger: createCapturingLogger().logger,
        leaseMs: 60_000,
        runJob: async (job: ReviewJob) => {
          seen.push(job.prNumber);
          return "succeeded";
        },
      },
      { once: true, pollMs: 1 },
    );
    expect(processed).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it("polls an empty queue until stopped", async () => {
    const stop = new AbortController();
    const running = runWorker(
      {
        database,
        logger: createCapturingLogger().logger,
        leaseMs: 60_000,
        runJob: async () => "succeeded",
      },
      { once: false, pollMs: 5, signal: stop.signal },
    );
    setTimeout(() => stop.abort(), 20);
    await expect(running).resolves.toBe(0);
  });

  it("keeps going after a job throws", async () => {
    await enqueueReviewJob(database, { repoId, prNumber: 1, headSha: "a", deliveryId: "d1" });
    await enqueueReviewJob(database, { repoId, prNumber: 2, headSha: "a", deliveryId: "d2" });
    const { logger, entries } = createCapturingLogger();
    const processed = await runWorker(
      {
        database,
        logger,
        leaseMs: 60_000,
        runJob: async (job) => {
          if (job.prNumber === 1) throw new Error("database blip");
          return "succeeded";
        },
      },
      { once: true, pollMs: 1 },
    );
    expect(processed).toBe(2);
    expect(entries).toContainEqual(expect.objectContaining({ event: "worker.job_crashed" }));
  });
});

describe("runWorker crash logging", () => {
  const TOKEN = "ghs_installation_token_1234";
  const API_KEY = "sk-ant-api03-very-secret-key-9f3a";

  it("AC21: the worker.job_crashed log has the token and model key masked", async () => {
    const encryptionKey = randomBytes(32);
    await database.update(organizations).set({ installationId: 555 });
    await saveModelKey(database, organizationId, { provider: "anthropic", apiKey: API_KEY }, encryptionKey);
    await enqueueReviewJob(database, { repoId, prNumber: 42, headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e", deliveryId: "d1" });
    const state: { broken?: Error } = {};
    // Settling the job rejects once the review has failed, so runReviewJob rejects.
    const jobDatabase = new Proxy(database, {
      get(target, prop) {
        if (prop === "update" && state.broken) {
          const error = state.broken;
          return () => {
            throw error;
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const failing = makeModel([]).model;
    failing.doGenerate = async () => {
      state.broken = new Error(`connection reset saving ${TOKEN} with ${API_KEY}`);
      throw new Error("overloaded");
    };
    const github = makeGithub();
    const jobLog = createCapturingLogger();
    const jobDeps: JobRunnerDeps = {
      database: jobDatabase,
      withWriteDatabase: (run) => run(database),
      github: { createInstallationToken: async () => TOKEN },
      createClient: () => github,
      createLanguageModel: () => failing,
      encryptionKey,
      logger: jobLog.logger,
      settingsUrl: () => undefined,
      lease: { leaseMs: 60_000, heartbeatMs: 60_000 },
      retry: { maxAttempts: 3, retryDelayMs: 0 },
    };
    const { logger, entries } = createCapturingLogger();

    const processed = await runWorker(
      { database, logger, leaseMs: 60_000, runJob: (job) => runReviewJob(jobDeps, job) },
      { once: true, pollMs: 1 },
    );

    expect(processed).toBe(1);
    const crashed = entries.find((entry) => entry.event === "worker.job_crashed");
    expect(crashed).toBeDefined();
    expect(crashed).toMatchObject({ error: expect.stringContaining("[redacted]") });
    const text = JSON.stringify(entries);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(API_KEY);
  });
});
