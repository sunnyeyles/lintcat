/** One `pr-review review`: the MCP server's local review path, printed to a terminal. */
import path from "node:path";

import { apiKeyEnvFor, MODEL_PROVIDERS } from "@pr-review/ai";
import { createSilentLogger } from "@pr-review/logging";
import {
  hasModelApiKey,
  modelReviewEngine,
  openLocalMemoryStore,
  openLocalRepository,
  rejectLegacyAgentConfig,
  runReview,
  type McpEnvironment,
} from "@pr-review/mcp/local-review";

import type { ReviewOptions } from "#src/options";
import { blockingFindings, orderFindings, renderFinding, renderSummary } from "#src/render";

export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_ERROR = 2;
export const EXIT_CANCELLED = 3;

export interface CliDeps {
  environment: McpEnvironment;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Aborting it cancels the review and its in-flight model calls. */
  signal?: AbortSignal | undefined;
}

export const CANCELLED_MESSAGE = "pr-review: review cancelled before it finished; no verdict was reached.";

/** Said before any git or model work, so a keyless machine fails in a second. */
export function missingKeyMessage(): string {
  return (
    `No model API key is set, so there is nothing to run the review with. Set ` +
    `${MODEL_PROVIDERS.map(apiKeyEnvFor).join(" or ")} in your environment or in this project's .env.local.`
  );
}

export async function runReviewCommand(options: ReviewOptions, deps: CliDeps): Promise<number> {
  const { signal, err } = deps;
  try {
    const code = await review(options, deps);
    if (signal?.aborted !== true) return code;
  } catch (error: unknown) {
    // Only our own interrupt is a cancellation; a stray AbortError is a failure.
    if (signal?.aborted !== true) throw error;
  }
  err(CANCELLED_MESSAGE);
  return EXIT_CANCELLED;
}

async function review(
  options: ReviewOptions,
  { environment, out, err, signal }: CliDeps,
): Promise<number> {
  if (!hasModelApiKey(environment)) {
    err(missingKeyMessage());
    return EXIT_ERROR;
  }
  const local = await openLocalRepository(
    path.resolve(environment.cwd, options.repoPath ?? "."),
    options.base,
    options.scope,
  );
  await rejectLegacyAgentConfig(local.root);
  const changed = await local.client.listChangedFiles(local.target);
  const where = `${local.scope.headLabel} of ${local.root} against ${local.baseRef} (${local.baseSha.slice(0, 7)})`;
  if (changed.length === 0) {
    out(`Nothing to review: no changes in ${where}.`);
    return EXIT_OK;
  }
  err(`Reviewing ${changed.length} changed file(s): ${where}.`);

  const result = await runReview(
    { ...environment, logger: options.verbose ? environment.logger : createSilentLogger() },
    {
      client: local.client,
      target: local.target,
      selected: modelReviewEngine(environment),
      index: options.index,
      memory: await openLocalMemoryStore(local.root),
      signal,
    },
  );

  if (signal?.aborted === true) return EXIT_CANCELLED;
  const { findings, suppressed } = result.outcome;
  const blocking = blockingFindings(findings, options.failOn);
  const render = { color: options.color ?? false };
  for (const finding of orderFindings(findings)) {
    out("");
    out(renderFinding(finding, render));
  }
  out("");
  out(
    renderSummary(
      {
        findings,
        blocking,
        failOn: options.failOn,
        suppressed,
      },
      render,
    ),
  );
  return blocking.length > 0 ? EXIT_BLOCKED : EXIT_OK;
}
