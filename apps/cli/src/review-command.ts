/** One `pr-review review`: the MCP server's local review path, printed to a terminal. */
import path from "node:path";

import { modelApiKeyEnvNames } from "@pr-review/ai";
import { createSilentLogger } from "@pr-review/logging";
import {
  hasModelApiKey,
  modelReviewEngine,
  reviewLocalCheckout,
  type McpEnvironment,
} from "@pr-review/mcp/local-review";

import type { ReviewOptions } from "#src/options";
import { blockingFindings, orderFindings, renderFinding, renderSummary } from "#src/render";

export const EXIT_OK = 0;
const EXIT_BLOCKED = 1;
export const EXIT_ERROR = 2;
export const EXIT_CANCELLED = 3;

export interface CliDeps {
  environment: McpEnvironment;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Aborting it cancels the review and its in-flight model calls. */
  signal?: AbortSignal | undefined;
}

const CANCELLED_MESSAGE = "pr-review: review cancelled before it finished; no verdict was reached.";

/** Said before any git or model work, so a keyless machine fails in a second. */
function missingKeyMessage(): string {
  return (
    `No model API key is set, so there is nothing to run the review with. Set ` +
    `${modelApiKeyEnvNames()} in your environment or in this project's .env.local.`
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
  const { result, where } = await reviewLocalCheckout(
    { ...environment, logger: options.verbose ? environment.logger : createSilentLogger() },
    {
      repoPath: path.resolve(environment.cwd, options.repoPath ?? "."),
      base: options.base,
      scope: options.scope,
      selectEngine: () => modelReviewEngine(environment),
      index: options.index,
      signal,
      onStart: (changed, at) => err(`Reviewing ${changed} changed file(s): ${at}.`),
    },
  );
  if (result === undefined) {
    out(`Nothing to review: no changes in ${where}.`);
    return EXIT_OK;
  }

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
