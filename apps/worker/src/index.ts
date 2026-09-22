/** The worker entrypoint. Wiring only: read the environment, build clients, run the loop. */
import process from "node:process";

import { createLanguageModel } from "@pr-review/ai";
import { db, findLocalEnvFile, modelKeyEncryptionKey } from "@pr-review/db";
import { createGithubAppClient, createTokenClient } from "@pr-review/github";
import { createConsoleLogger, errorMessage } from "@pr-review/logging";

import { runReviewJob, type JobRunnerDeps } from "#src/run-job";
import { createDrainer, createHttpServer, listen } from "#src/server";
import { runWorker, type WorkerDeps } from "#src/worker";

const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; add it to .env.local`);
  return value;
}

async function main(): Promise<void> {
  const envFile = findLocalEnvFile();
  if (envFile) process.loadEnvFile(envFile);
  const logger = createConsoleLogger();
  const database = db();
  const appDomain = process.env.APP_DOMAIN?.trim();

  const jobDeps: JobRunnerDeps = {
    database,
    // Single-line env values carry the PEM's newlines as literal `\n`.
    github: createGithubAppClient({
      appId: required("GITHUB_APP_ID"),
      privateKey: required("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
    }),
    createClient: (token) => createTokenClient({ token }),
    createLanguageModel,
    encryptionKey: modelKeyEncryptionKey(),
    logger,
    settingsUrl: (slug) => (appDomain ? `https://${slug}.${appDomain}/settings` : undefined),
    lease: { leaseMs: LEASE_MS, heartbeatMs: HEARTBEAT_MS },
    retry: { maxAttempts: MAX_ATTEMPTS, retryDelayMs: RETRY_DELAY_MS },
  };

  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logger.info("worker.stopping", { signal });
      stop.abort();
    });
  }

  const workerDeps: WorkerDeps = {
    database,
    logger,
    leaseMs: LEASE_MS,
    runJob: (job) => runReviewJob(jobDeps, job),
  };

  // Cloud Run sets PORT; local dev leaves it unset and keeps the poll loop below.
  const port = process.env.PORT;
  if (port) {
    const drain = createDrainer(() => runWorker(workerDeps, { once: true, pollMs: 0 }));
    const server = createHttpServer(drain, { secret: required("WORKER_PING_SECRET") }, logger);
    stop.signal.addEventListener("abort", () => server.close());
    await listen(server, Number(port));
    logger.info("worker.listening", { port: Number(port) });
    return;
  }

  const once = process.argv.includes("--once");
  logger.info("worker.started", { once });
  const processed = await runWorker(workerDeps, {
    once,
    pollMs: Number(process.env.WORKER_POLL_MS ?? 5_000),
    signal: stop.signal,
  });
  logger.info("worker.stopped", { processed });
}

main().catch((error: unknown) => {
  createConsoleLogger().error("worker.failed", { error: errorMessage(error) });
  process.exitCode = 1;
});
