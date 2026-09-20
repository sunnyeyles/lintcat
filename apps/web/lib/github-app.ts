import { createGithubAppClient, type GithubAppClient } from "@pr-review/github";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; add it to .env.local`);
  return value;
}

export function githubWebhookSecret(): string {
  return required("GITHUB_APP_WEBHOOK_SECRET");
}

/** GitHub's install page for the App; undefined until GITHUB_APP_SLUG is set, so the button can hide. */
export function installAppUrl(): string | undefined {
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  if (!slug) return undefined;
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}

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
