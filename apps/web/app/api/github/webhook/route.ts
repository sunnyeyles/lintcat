import { db, pruneWorkflowRuns, withWriteDatabase } from "@pr-review/db";
import { createConsoleLogger } from "@pr-review/logging";
import { after } from "next/server";

import { githubApp, githubWebhookSecret } from "@/lib/github-app";
import { hostedWorkerPinger } from "@/lib/worker-ping";

import { handleGithubWebhook } from "./handler";

export const runtime = "nodejs";

const CI_RETENTION_MS = 30 * 86_400_000;

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = githubWebhookSecret();
  const logger = createConsoleLogger();
  const response = await withWriteDatabase((database) =>
    handleGithubWebhook(request, {
      database,
      github: githubApp(),
      logger,
      webhookSecret,
      pingWorker: hostedWorkerPinger(logger),
    }),
  );
  // Only a signed, stored run pays for the prune.
  if (response.status === 200 && request.headers.get("x-github-event") === "workflow_run") {
    after(() => pruneWorkflowRuns(db(), new Date(Date.now() - CI_RETENTION_MS)));
  }
  return response;
}
