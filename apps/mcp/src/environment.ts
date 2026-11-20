import { execFile } from "node:child_process";
import process from "node:process";

import {
  apiKeyEnvFor,
  createLanguageModel,
  DEFAULT_MODEL_PROVIDER,
  defaultModelFor,
  MODEL_PROVIDERS,
  resolveModelProvider,
  type LanguageModelConfig,
  type ModelProvider,
  type ReviewModel,
} from "@pr-review/ai";
import { db, type Database } from "@pr-review/db";
import {
  createTokenClient,
  type GithubTokenConfig,
  type PullRequestReadClient,
  type RepositoryHistoryClient,
  type ReviewPublishClient,
} from "@pr-review/github";
import { createStderrLogger, type StructuredLogger } from "@pr-review/logging";

/** Everything the tools read from outside the process; tests pass fakes. */
export interface McpEnvironment {
  env: Record<string, string | undefined>;
  /** Where a tool without `repoPath` looks for a checkout. */
  cwd: string;
  logger: StructuredLogger;
  createLanguageModel: (config: LanguageModelConfig) => ReviewModel;
  createTokenClient: (
    config: GithubTokenConfig,
  ) => PullRequestReadClient & RepositoryHistoryClient & ReviewPublishClient;
  /** Runs the `gh` CLI and returns its stdout. */
  gh: (args: readonly string[]) => Promise<string>;
  database: () => Database;
}

function runGh(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", args, (error, stdout, stderr) => {
      if (error) {
        const missing = (error as { code?: unknown }).code === "ENOENT";
        reject(
          new Error(
            missing
              ? "the GitHub CLI (gh) is not installed; install it or set GITHUB_TOKEN"
              : `gh ${args.join(" ")} failed: ${String(stderr).trim() || error.message}`,
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export function processEnvironment(): McpEnvironment {
  return {
    env: process.env,
    cwd: process.cwd(),
    logger: createStderrLogger(),
    createLanguageModel,
    createTokenClient,
    gh: runGh,
    database: db,
  };
}

const apiKeyOf = (env: McpEnvironment["env"], provider: ModelProvider) =>
  env[apiKeyEnvFor(provider)]?.trim() ?? "";

/** Unset, the default provider wins when its key is present, else any provider that has one. */
function selectProvider(env: Record<string, string | undefined>): ModelProvider {
  const named = env["PR_REVIEW_MODEL_PROVIDER"]?.trim() ?? "";
  if (named !== "") {
    return resolveModelProvider(named);
  }
  const hasKey = (provider: ModelProvider) => apiKeyOf(env, provider) !== "";
  return [DEFAULT_MODEL_PROVIDER, ...MODEL_PROVIDERS].find(hasKey) ?? DEFAULT_MODEL_PROVIDER;
}

/** Whether resolveModel would find a key; a named but unknown provider still throws. */
export function hasModelApiKey(environment: McpEnvironment): boolean {
  const { env } = environment;
  return apiKeyOf(env, selectProvider(env)) !== "";
}

/** Reads PR_REVIEW_MODEL_PROVIDER / PR_REVIEW_MODEL / PR_REVIEW_MODEL_BASE_URL and the provider's key. */
export function resolveModel(environment: McpEnvironment): ReviewModel {
  const { env } = environment;
  const provider = selectProvider(env);
  const apiKey = apiKeyOf(env, provider);
  if (apiKey === "") {
    const keys = MODEL_PROVIDERS.map(apiKeyEnvFor).join(" or ");
    throw new Error(`No model API key is set. Set ${keys} in the MCP server's environment or .env.local.`);
  }
  const baseUrl = env["PR_REVIEW_MODEL_BASE_URL"]?.trim() ?? "";
  const modelId = env["PR_REVIEW_MODEL"]?.trim() || defaultModelFor(provider);
  return environment.createLanguageModel({
    provider,
    apiKey,
    ...(baseUrl === "" ? {} : { baseUrl }),
    modelId,
  });
}

/** GITHUB_TOKEN, then GH_TOKEN, then the `gh` CLI's own login. */
export async function resolveGithubToken(environment: McpEnvironment): Promise<string> {
  const fromEnv = (environment.env["GITHUB_TOKEN"] ?? environment.env["GH_TOKEN"])?.trim();
  return fromEnv || environment.gh(["auth", "token"]);
}
