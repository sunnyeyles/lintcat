/**
 * The deterministic Layer A block in the opening message. Paths are data
 * inside tags, the same as the changed-file list: nothing is escaped.
 */
import type { AreaDescription, RepositoryIndex } from "./types.js";

/** Changed files listed before the block collapses to a count. */
export const MAX_INDEX_LINES = 300;

const HOUR_MS = 60 * 60 * 1000;

const ABSENT_BLOCK =
  '<repository_index status="absent">no repository index for this review</repository_index>';

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** A test beside the file it covers is named by its basename alone. */
function shortTest(test: string, path: string): string {
  return directoryOf(test) === directoryOf(path)
    ? test.slice(test.lastIndexOf("/") + 1)
    : test;
}

function ageHours(builtAt: string, now: Date): number {
  const built = Date.parse(builtAt);
  if (Number.isNaN(built)) return 0;
  return Math.max(0, Math.round((now.getTime() - built) / HOUR_MS));
}

function renderLine(area: AreaDescription): string {
  const parts: string[] = [area.package?.name ?? "no package"];
  if (area.role !== null) parts.push(area.role);
  if (area.tests.length > 0) {
    parts.push(
      `tested by ${area.tests.map((test) => shortTest(test, area.path)).join(", ")}`,
    );
  }
  if (area.owners.length > 0) parts.push(`owners ${area.owners.join(" ")}`);
  return `- ${area.path} — ${parts.join(", ")}${area.known ? "" : " (not in index)"}`;
}

/** The block for one review; an absent index says so in one line. */
export async function renderRepositoryIndexBlock(
  index: RepositoryIndex | undefined,
  changedPaths: readonly string[],
  now: Date = new Date(),
): Promise<string> {
  if (index === undefined) return ABSENT_BLOCK;
  const status = await index.status();

  const lines: string[] = [];
  for (const path of changedPaths.slice(0, MAX_INDEX_LINES)) {
    lines.push(renderLine(await index.describeArea(path)));
  }
  if (changedPaths.length > MAX_INDEX_LINES) {
    lines.push(`- [... ${changedPaths.length - MAX_INDEX_LINES} more files]`);
  }

  return [
    `<repository_index sha="${status.sha}" age_hours="${ageHours(status.builtAt, now)}">`,
    ...lines,
    "</repository_index>",
  ].join("\n");
}
