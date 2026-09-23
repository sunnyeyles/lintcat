/** The `<imports>` block: what each changed file imports at HEAD, and whether it resolves. */
import type { ChangedFile, PullRequestReadClient } from "@pr-review/github";
import {
  INDEXED_LANGUAGES,
  languageOf,
  resolveHeadImports,
  type HeadImport,
  type RepositoryIndex,
} from "@pr-review/index";

import type { ReviewContext } from "#src/agent-contract";

/** Each file listed costs one contents request before the agent starts. */
const MAX_RESOLVED_FILES = 40;

/** Import lines rendered across every file before the block is cut short. */
const MAX_IMPORT_LINES = 400;

const ADDED_STATUSES = new Set(["added", "renamed", "copied"]);

function pathsWithStatus(
  files: readonly ChangedFile[],
  matches: (status: string) => boolean,
): Set<string> {
  return new Set(files.filter((file) => matches(file.status)).map((file) => file.filename));
}

/** undefined without an index; a file whose contents fail to load is left out. */
export async function loadHeadImports(
  github: Pick<PullRequestReadClient, "getFileContents">,
  context: ReviewContext,
  index: RepositoryIndex | undefined,
): Promise<Map<string, HeadImport[]> | undefined> {
  if (index === undefined) {
    return undefined;
  }
  const whole = (context.incremental ?? context).changedFiles;
  const targets = context.changedFiles
    .filter(
      (file) =>
        file.status !== "removed" && INDEXED_LANGUAGES.has(languageOf(file.filename)),
    )
    .slice(0, MAX_RESOLVED_FILES)
    .map((file) => file.filename);

  const loaded = await Promise.allSettled(
    targets.map(async (path) => {
      const contents = await github.getFileContents({
        owner: context.owner,
        repo: context.repo,
        path,
        ref: context.pullRequest.headSha,
      });
      return [path, contents] as const;
    }),
  );
  const contents = new Map(
    loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  );

  return resolveHeadImports(index, {
    contents,
    added: pathsWithStatus(whole, (status) => ADDED_STATUSES.has(status)),
    removed: pathsWithStatus(whole, (status) => status === "removed"),
  });
}

function describe(entry: HeadImport): string {
  const target = entry.path === undefined ? "unresolved" : entry.path;
  return `  - line ${entry.line} "${entry.specifier}" → ${target}`;
}

/** Third-party imports are left out: the index cannot judge them. */
export function renderHeadImports(
  imports: ReadonlyMap<string, readonly HeadImport[]> | undefined,
): string[] {
  if (imports === undefined || imports.size === 0) {
    return [];
  }
  const lines: string[] = [];
  let listed = 0;
  let cut = 0;
  for (const [path, entries] of imports) {
    const internal = entries.filter((entry) => entry.internal);
    if (internal.length === 0) {
      continue;
    }
    const shown = internal.slice(0, MAX_IMPORT_LINES - listed);
    cut += internal.length - shown.length;
    if (shown.length === 0) {
      continue;
    }
    lines.push(`- ${path}`, ...shown.map(describe));
    listed += shown.length;
  }
  if (lines.length === 0) {
    return [];
  }
  if (cut > 0) {
    lines.push(`- [... ${cut} more imports]`);
  }
  return [
    '<imports ref="head">',
    "Internal imports in the changed files, resolved against the repository with this pull request applied.",
    "A resolved import names a file that exists: never report it missing. An unresolved one may be a case the index does not understand; check it with get_file before reporting it.",
    ...lines,
    "</imports>",
    "",
  ];
}
