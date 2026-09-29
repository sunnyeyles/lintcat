/** `pr-review suppress <id>`: the MCP server's suppress_finding, for a finding the last review reported. */
import path from "node:path";

import { recordSuppression, repositoryRoot } from "@pr-review/mcp/local-review";

import type { SuppressOptions } from "#src/options";
import { readLastReview, reviewCachePath } from "#src/review-cache";
import { EXIT_ERROR, EXIT_OK, type CliDeps } from "#src/review-command";

export async function runSuppressCommand(options: SuppressOptions, { environment, out, err }: CliDeps): Promise<number> {
  const root = await repositoryRoot(path.resolve(environment.cwd, options.repoPath ?? "."));
  const last = readLastReview(await reviewCachePath(root));
  const finding = last?.report.findings.find((candidate) => candidate.id === options.id);
  if (finding === undefined) {
    err(`pr-review: no finding "${options.id}" in the last review of ${root}; run a review, then copy an id from it.`);
    return EXIT_ERROR;
  }
  const recorded = await recordSuppression(
    root,
    { category: finding.category, title: finding.title, reason: options.reason },
    environment.logger,
  );
  out(
    `Suppressed ${finding.category} findings shaped like "${recorded.shape}". ` +
      `${recorded.suppressions.length} suppression(s) now live in ${recorded.path}.`,
  );
  return EXIT_OK;
}
