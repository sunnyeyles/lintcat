import { createGithubAppClient, type GithubAppClient } from "@pr-review/github";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; add it to .env.local`);
  return value;
}

export function githubWebhookSecret(): string {
  return required("GITHUB_APP_WEBHOOK_SECRET");
}

// Single-line env values carry the PEM's newlines as literal `\n`.
export function githubApp(): GithubAppClient {
  return createGithubAppClient({
    appId: required("GITHUB_APP_ID"),
    privateKey: required("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
  });
}
