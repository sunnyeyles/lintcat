import { createGithubAppClient, type GithubAppClient } from "@pr-review/github";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; add it to .env.local`);
  return value;
}

export function githubWebhookSecret(): string {
  return required("GITHUB_APP_WEBHOOK_SECRET");
}

export const INSTALL_APP_URL = "https://github.com/apps/lintcatpr/installations/new";

let cached: GithubAppClient | undefined;

// Kept per process so installation tokens are reused while they last.
// Single-line env values carry the PEM's newlines as literal `\n`.
export function githubApp(): GithubAppClient {
  cached ??= createGithubAppClient({
    appId: required("GITHUB_APP_ID"),
    privateKey: required("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
  });
  return cached;
}
