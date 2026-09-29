/** The `<convention_counts>` block: conventions measured in code over each changed file's siblings. */
import { changedPaths } from "@pr-review/github";
import {
  conventionCounts,
  conventionSentence,
  MIN_MAJORITY,
  type RepositoryIndex,
} from "@pr-review/index";

import type { ReviewContext } from "#src/agent-contract";

/** Nothing renders for a file whose siblings share no clear convention. */
export function renderConventionCounts(
  index: RepositoryIndex | undefined,
  context: Pick<ReviewContext, "changedFiles" | "incremental">,
  maxListedFiles: number,
): string[] {
  if (index === undefined) {
    return [];
  }
  const changed = changedPaths((context.incremental ?? context).changedFiles);
  const lines = context.changedFiles
    .filter((file) => file.status !== "removed")
    .slice(0, maxListedFiles)
    .flatMap((file) => {
      const counts = conventionCounts(index, file.filename, changed);
      if (counts.length === 0) {
        return [];
      }
      return [
        `- ${file.filename}:`,
        ...counts.map((count) => `  - ${count.convention}: ${conventionSentence(count)}`),
      ];
    });
  if (lines.length === 0) {
    return [];
  }
  const share = `${Math.round(MIN_MAJORITY * 100)}%`;
  return [
    "<convention_counts>",
    `Measured over the sibling files at the base commit; a convention is listed only when at least ${share} of the siblings it could be read from agree. Whether the changed file follows it is for you to check.`,
    `Cite one as evidence with {"convention": "<name>", "file": "<changed file>"}. It stands for the siblings it counts, so you need not read them to cite it.`,
    ...lines,
    "</convention_counts>",
    "",
  ];
}
