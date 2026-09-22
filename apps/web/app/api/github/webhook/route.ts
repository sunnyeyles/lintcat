import { withWriteDatabase } from "@pr-review/db";
import { createConsoleLogger } from "@pr-review/logging";

import { githubApp, githubWebhookSecret } from "@/lib/github-app";
import { hostedWorkerPinger } from "@/lib/worker-ping";

import { handleGithubWebhook } from "./handler";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  const webhookSecret = githubWebhookSecret();
  const logger = createConsoleLogger();
  return withWriteDatabase((database) =>
    handleGithubWebhook(request, {
      database,
      github: githubApp(),
      logger,
      webhookSecret,
      pingWorker: hostedWorkerPinger(logger),
    }),
  );
}
