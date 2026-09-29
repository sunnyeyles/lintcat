/** One `pr-review review`: the MCP server's local review path, printed to a terminal. */
import path from "node:path";

import { apiKeyEnvFor, defaultModelFor, MODEL_PROVIDERS } from "@pr-review/ai";
import { createSilentLogger } from "@pr-review/logging";
import {
  hasModelApiKey,
  modelIdentity,
  modelReviewEngine,
  openLocalMemoryStore,
  openLocalRepository,
  reviewedTree,
  runReview,
  type McpEnvironment,
} from "@pr-review/mcp/local-review";
import { CI_REVIEW_POLICY, findingId } from "@pr-review/reviewer";
import type { LocalReviewReport } from "@pr-review/schemas";

import type { ReviewOptions } from "#src/options";
import { readLastReview, reviewCachePath, writeLastReview } from "#src/review-cache";
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
  /** The whole of standard input; only a hook reads it. */
  stdin?: (() => Promise<string>) | undefined;
}

const CANCELLED_MESSAGE = "pr-review: review cancelled before it finished; no verdict was reached.";

/** Said before any git or model work, so a keyless machine fails in a second. */
export function missingKeyMessage(): string {
  return (
    `No model API key is set, so there is nothing to run the review with. Set ` +
    `${MODEL_PROVIDERS.map(apiKeyEnvFor).join(" or ")} in your environment or in this project's .env.local.`
  );
}

export async function runReviewCommand(options: ReviewOptions, deps: CliDeps): Promise<number> {
  const { signal, out, err } = deps;
  if (!hasModelApiKey(deps.environment)) {
    err(missingKeyMessage());
    return EXIT_ERROR;
  }
  try {
    const report = await reviewReport(options, deps);
    if (signal?.aborted !== true) {
      if (options.format === "json") out(JSON.stringify(report, null, 2));
      else printText(report, options.color ?? false, out);
      return report.blocking > 0 ? EXIT_BLOCKED : EXIT_OK;
    }
  } catch (error: unknown) {
    // Only our own interrupt is a cancellation; a stray AbortError is a failure.
    if (signal?.aborted !== true) throw error;
  }
  err(CANCELLED_MESSAGE);
  return EXIT_CANCELLED;
}

/** The report, or undefined when the reviewed slice holds no change. */
export async function reviewReport(
  options: ReviewOptions,
  { environment, err, signal }: CliDeps,
): Promise<LocalReviewReport> {
  const local = await openLocalRepository(
    path.resolve(environment.cwd, options.repoPath ?? "."),
    options.base,
    options.scope,
  );
  const report = (fields: Partial<LocalReviewReport>): LocalReviewReport => ({
    version: 1,
    profile: options.profile,
    model: null,
    baseRef: local.baseRef,
    baseSha: local.baseSha,
    head: local.target.headSha,
    failOn: options.failOn,
    cached: false,
    findings: [],
    blocking: 0,
    suppressed: 0,
    summary: "",
    ...fields,
  });
  const changed = await local.client.listChangedFiles(local.target);
  const where = `${local.scope.headLabel} of ${local.root} against ${local.baseRef} (${local.baseSha.slice(0, 7)})`;
  if (changed.length === 0) {
    err(`Nothing to review: no changes in ${where}.`);
    return report({});
  }

  const ci = options.profile === "ci";
  const memory = ci ? undefined : await openLocalMemoryStore(local.root);
  const cacheFile = await reviewCachePath(local.root);
  const key = JSON.stringify({
    tree: await reviewedTree(local),
    baseSha: local.baseSha,
    profile: options.profile,
    index: options.index,
    model: modelIdentity(environment),
    memory: (await memory?.read()) ?? null,
  });
  const earlier = options.cache ? readLastReview(cacheFile) : undefined;
  if (earlier?.key === key) {
    err(`Reusing the review of ${where} from the cache; --no-cache runs it again.`);
    return report({
      ...earlier.report,
      failOn: options.failOn,
      blocking: blockingFindings(earlier.report.findings, options.failOn).length,
      cached: true,
    });
  }
  err(`Reviewing ${changed.length} changed file(s): ${where}.`);

  const selected = modelReviewEngine(environment);
  if (selected.model !== undefined) {
    const { provider, modelId } = selected.model;
    err(`Model: ${provider} ${modelId}`);
    const ciModel = defaultModelFor(provider);
    if (options.profile === "ci" && modelId !== ciModel) {
      err(`Warning: CI reviews with ${ciModel} unless the repository's settings choose another model.`);
    }
  }
  const result = await runReview(
    { ...environment, logger: options.verbose ? environment.logger : createSilentLogger() },
    {
      client: local.client,
      target: local.target,
      selected,
      index: options.index,
      ...(ci ? { policy: CI_REVIEW_POLICY } : { memory }),
      signal,
    },
  );
  const { findings, suppressed } = result.outcome;
  const reviewed = report({
    model: selected.model ?? null,
    findings: orderFindings(findings).map((finding) => ({ ...finding, id: findingId(finding) })),
    blocking: blockingFindings(findings, options.failOn).length,
    suppressed,
    summary: result.summary,
  });
  if (signal?.aborted !== true) writeLastReview(cacheFile, { key, report: reviewed });
  return reviewed;
}

function printText(report: LocalReviewReport, color: boolean, out: (text: string) => void): void {
  if (report.summary === "") {
    out("Nothing to review.");
    return;
  }
  const render = { color };
  for (const finding of report.findings) {
    out("");
    out(renderFinding(finding, render));
  }
  out("");
  out(
    renderSummary(
      {
        findings: report.findings,
        blocking: blockingFindings(report.findings, report.failOn),
        failOn: report.failOn,
        suppressed: report.suppressed,
      },
      render,
    ),
  );
}
