/**
 * The `<repository_index>` block of the opening message: what the index knows
 * about each changed file. Absent, it still renders, so the prompt shape holds.
 */
import type { ChangedFile } from "@pr-review/github";
import type { IndexedFile, RepositoryIndex } from "@pr-review/index";

/** Said when there is no index, so an agent falls back instead of retrying. */
export const INDEX_ABSENT_LINE =
  "No repository index is available for this review; use the other tools instead.";

/** Said for a path the index has no entry for, an addition included. */
const UNKNOWN_LINE = "not in the index at this commit";

function describe(file: IndexedFile): string {
  if (file.role === "test" && file.covers !== undefined) {
    return `test, covers ${file.covers}`;
  }
  if (file.coveredBy !== undefined) {
    return `${file.role}, covered by ${file.coveredBy}`;
  }
  return `${file.role}, no test`;
}

/**
 * One line per changed file, capped at `maxListedFiles` with the same
 * truncation line the changed-files block uses.
 */
export function renderRepositoryIndex(
  index: RepositoryIndex | undefined,
  changedFiles: readonly ChangedFile[],
  maxListedFiles: number,
): string[] {
  if (index === undefined) {
    return ["<repository_index>", INDEX_ABSENT_LINE, "</repository_index>"];
  }

  const lines = changedFiles.slice(0, maxListedFiles).map((file) => {
    const indexed = index.files.get(file.filename);
    return `- ${file.filename} — ${indexed === undefined ? UNKNOWN_LINE : describe(indexed)}`;
  });
  if (changedFiles.length > maxListedFiles) {
    lines.push(`- [... ${changedFiles.length - maxListedFiles} more files]`);
  }

  return [
    `<repository_index sha="${index.sha}" truncated="${index.truncated}">`,
    ...lines,
    "</repository_index>",
  ];
}
