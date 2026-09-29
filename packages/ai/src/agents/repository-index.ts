/**
 * The `<repository_index>` block of the opening message: what the index knows
 * about each changed file. Absent, it still renders, so the prompt shape holds.
 */
import { changedPaths, type ChangedFile } from "@pr-review/github";
import {
  siblingsOf,
  type IndexedFile,
  type LanguageCoverage,
  type RepositoryIndex,
} from "@pr-review/index";

import type { ReviewContext } from "#src/agent-contract";

/** Said when there is no index, so an agent falls back instead of retrying. */
export const INDEX_ABSENT_LINE =
  "No repository index is available for this review; use the other tools instead.";

/** Said for a path the index has no entry for, an addition included. */
const UNKNOWN_LINE = "not in the index at this commit";

function importers(file: IndexedFile): string {
  return `${file.importerCount} importer${file.importerCount === 1 ? "" : "s"}`;
}

/** The graph flags, appended only when they are true. */
function flags(file: IndexedFile): string {
  return [
    ...(file.inCycle ? ["in import cycle"] : []),
    ...(file.dead ? ["dead (not an entry point)"] : []),
  ]
    .map((flag) => `, ${flag}`)
    .join("");
}

function describe(file: IndexedFile): string {
  const owner = file.package === undefined ? "" : `${file.package}, `;
  const tail = `${importers(file)}${flags(file)}`;
  if (file.role === "test" && file.covers !== undefined) {
    return `${owner}test, covers ${file.covers}, ${tail}`;
  }
  if (file.coveredBy !== undefined) {
    return `${owner}${file.role}, covered by ${file.coveredBy}, ${tail}`;
  }
  return `${owner}${file.role}, no test, ${tail}`;
}

/** Workspace packages listed in the overview before the list is cut short. */
const MAX_LISTED_PACKAGES = 50;

/** Languages named in the coverage summary; the rest are a count. */
const MAX_LISTED_LANGUAGES = 8;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeLanguage(entry: LanguageCoverage): string {
  if (!entry.indexed || entry.resolution === undefined) {
    return `${entry.language} ${plural(entry.files, "file")} (not indexed)`;
  }
  const { internal, resolved, rate } = entry.resolution;
  const percent = `${Math.round(rate * 100)}%`;
  return `${entry.language} ${plural(entry.files, "file")} (indexed, ${resolved}/${internal} internal imports resolved, ${percent})`;
}

/** The coverage summary line: what was seen, and how much of it was placed. */
function coverageLine(coverage: readonly LanguageCoverage[]): string {
  const named = coverage.slice(0, MAX_LISTED_LANGUAGES).map(describeLanguage);
  if (coverage.length > MAX_LISTED_LANGUAGES) {
    named.push(`${coverage.length - MAX_LISTED_LANGUAGES} more languages`);
  }
  return `Languages: ${named.length === 0 ? "none seen" : named.join("; ")}`;
}

function packageLines(index: RepositoryIndex): string[] {
  if (index.packages.length === 0) {
    return ["Packages: none declared by a workspace manifest."];
  }
  const lines = index.packages
    .slice(0, MAX_LISTED_PACKAGES)
    .map((entry) => `- ${entry.name} — ${entry.root === "" ? "." : entry.root}`);
  if (index.packages.length > MAX_LISTED_PACKAGES) {
    lines.push(
      `- [... ${index.packages.length - MAX_LISTED_PACKAGES} more packages]`,
    );
  }
  return [`Packages (${index.packages.length}):`, ...lines];
}

/** The `<repository>` block: packages, commit, and what was read of each
 * language. Without an index nothing renders, and the next block says so. */
export function renderRepository(index: RepositoryIndex | undefined): string[] {
  if (index === undefined) {
    return [];
  }
  return [
    `<repository sha="${index.sha}" truncated="${index.truncated}">`,
    ...packageLines(index),
    coverageLine(index.coverage),
    "</repository>",
    "",
  ];
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

/** Siblings named per changed file before the rest become a count. */
const MAX_LISTED_SIBLINGS = 5;

/** The `<sibling_files>` block; siblings exclude every file the whole pull request changes. */
export function renderSiblingFiles(
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
      const siblings = siblingsOf(index, file.filename, changed);
      if (siblings.length === 0) {
        return [];
      }
      const named = siblings.slice(0, MAX_LISTED_SIBLINGS).map((sibling) => sibling.path);
      const more = siblings.length - named.length;
      return [`- ${file.filename}: ${named.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`];
    });
  if (lines.length === 0) {
    return [];
  }
  return [
    "<sibling_files>",
    "Unchanged files in the same directory, with the same role, as each changed file: the local convention to compare it against.",
    ...lines,
    "</sibling_files>",
    "",
  ];
}
