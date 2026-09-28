/** The `<config_drift>` block: env vars and dependencies the code found departing from the repository's own. */
import { changedPaths } from "@pr-review/github";
import { findConfigDrift, type RepositoryIndex, type SourceLine } from "@pr-review/index";

import type { ReviewContext } from "#src/agent-contract";

function cite(lines: readonly SourceLine[]): string {
  return lines.map((entry) => `${entry.file}:${entry.line}`).join(", ");
}

export function renderConfigDrift(
  index: RepositoryIndex | undefined,
  context: Pick<ReviewContext, "changedFiles" | "incremental">,
): string[] {
  if (index === undefined) {
    return [];
  }
  const { env, dependencies } = findConfigDrift(
    index,
    context.changedFiles,
    changedPaths((context.incremental ?? context).changedFiles),
  );
  const lines = [
    ...env.map(
      (entry) =>
        `- ${cite([entry.at])} reads ${entry.name}, which no env example or doc in this repository names; the others are documented at ${cite(entry.documented)}`,
    ),
    ...dependencies.map(
      (entry) =>
        `- ${cite([entry.at])} adds ${entry.name} for ${entry.purpose}, a job ${entry.existing} already does here: ${cite(entry.uses)}`,
    ),
  ];
  if (lines.length === 0) {
    return [];
  }
  return [
    "<config_drift>",
    'Found by code, not guessed. Report each as "config" drift unless the pull request says why, anchored on the line named first and citing the lines after it as evidence.',
    ...lines,
    "</config_drift>",
    "",
  ];
}
