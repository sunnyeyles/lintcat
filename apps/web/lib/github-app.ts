import { requiredEnv } from "@pr-review/db";
import { createGithubAppClient, type GithubAppClient } from "@pr-review/github";

export function githubWebhookSecret(): string {
  return requiredEnv("GITHUB_APP_WEBHOOK_SECRET");
}

export const INSTALL_APP_URL = "https://github.com/apps/LintcatPR/installations/new";

let cached: GithubAppClient | undefined;

// Kept per process so installation tokens are reused while they last.
// Single-line env values carry the PEM's newlines as literal `\n`.
export function githubApp(): GithubAppClient {
  cached ??= createGithubAppClient({
    appId: requiredEnv("GITHUB_APP_ID"),
    privateKey: requiredEnv("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
  });
  return cached;
}
