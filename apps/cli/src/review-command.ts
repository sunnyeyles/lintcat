/** One `pr-review review`: the MCP server's local review path, printed to a terminal. */
import path from "node:path";

import { apiKeyEnvFor, MODEL_PROVIDERS } from "@pr-review/ai";
import { createSilentLogger } from "@pr-review/logging";
import {
  hasModelApiKey,
  modelReviewEngine,
  openLocalMemoryStore,
  openLocalRepository,
  runReview,
  type McpEnvironment,
} from "@pr-review/mcp/local-review";

import type { ReviewOptions } from "#src/options";
import { blockingFindings, orderFindings, renderFinding, renderSummary } from "#src/render";

export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_ERROR = 2;

export interface CliDeps {
  environment: McpEnvironment;
  out: (text: string) => void;
  err: (text: string) => void;
}

/** Said before any git or model work, so a keyless machine fails in a second. */
export function missingKeyMessage(): string {
  return (
    `No model API key is set, so there is nothing to run the review with. Set ` +
    `${MODEL_PROVIDERS.map(apiKeyEnvFor).join(" or ")} in your environment or in this project's .env.local.`
  );
}

export async function runReviewCommand(
  options: ReviewOptions,
  { environment, out, err }: CliDeps,
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
      selected: modelReviewEngine(environment, {
        baseSha: local.baseSha,
        select: options.agents,
      }),
      index: options.index,
      memory: await openLocalMemoryStore(local.root),
      ...(options.progress
        ? { onAgentEvent: ({ agent, phase }) => err(`  ${agent} ${phase}`) }
        : {}),
    },
  );

  const { findings, suppressed, agentFailures } = result.outcome;
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
        agentFailures: agentFailures.map((failure) => failure.agent),
      },
      render,
    ),
  );
  return blocking.length > 0 ? EXIT_BLOCKED : EXIT_OK;
}
