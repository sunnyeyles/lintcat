import { withWriteDatabase } from "@pr-review/db";

import { githubApp, githubWebhookSecret } from "@/lib/github-app";

import { handleGithubWebhook } from "./handler";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  const webhookSecret = githubWebhookSecret();
  return withWriteDatabase((database) =>
    handleGithubWebhook(request, {
      database,
      github: githubApp(),
      webhookSecret,
    }),
  );
}
