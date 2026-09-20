/**
 * The one find-references query: its cap, its index header, its unknown-path
 * reply, its rendering and its tool description, for every surface that asks.
 */
import type { RepositoryIndex } from "#src/build";
import type { LanguageCoverage } from "#src/languages";
import { referencesTo, type Reference } from "#src/references";

/** Files returned per query; `total` carries the true count. */
export const MAX_REFERENCE_FILES = 50;

/** Never says the file does not exist: an index miss is not an absence. */
export const UNINDEXED_PATH_REASON =
  "not in the index: it is ignored, sits in a skipped directory, or is absent at the indexed commit";

/** What a caller needs to judge an empty result. */
export interface IndexHeader {
  readonly sha: string;
  readonly files: number;
  readonly truncated: boolean;
  readonly languages: readonly LanguageCoverage[];
}

export interface KnownReferences {
  readonly index: IndexHeader;
  readonly path: string;
  readonly name?: string;
  readonly known: true;
  readonly total: number;
  readonly references: readonly Reference[];
}

export interface UnknownReferences {
  readonly index: IndexHeader;
  readonly path: string;
  readonly known: false;
  readonly reason: string;
}

export type FindReferencesResult = KnownReferences | UnknownReferences;

export interface FindReferencesQuery {
  readonly path: string;
  /** One exported name from `path`; omit for every importer of the file. */
  readonly name?: string | undefined;
  /** A reason only the caller can know, e.g. the path is added by this pull request. */
  readonly absentReason?: string | undefined;
}

export function indexHeader(index: RepositoryIndex): IndexHeader {
  return {
    sha: index.sha,
    files: index.files.size,
    truncated: index.truncated,
    languages: index.coverage,
  };
}

export function unknownPath(
  index: RepositoryIndex,
  path: string,
  reason = UNINDEXED_PATH_REASON,
): UnknownReferences {
  return { index: indexHeader(index), path, known: false, reason };
}

export function findReferences(
  index: RepositoryIndex,
  { path, name, absentReason }: FindReferencesQuery,
): FindReferencesResult {
  if (absentReason !== undefined) {
    return unknownPath(index, path, absentReason);
  }
  if (!index.files.has(path)) {
    return unknownPath(index, path);
  }
  const references = referencesTo(index.importers, path, name);
  return {
    index: indexHeader(index),
    path,
    ...(name === undefined ? {} : { name }),
    known: true,
    total: references.length,
    references: references.slice(0, MAX_REFERENCE_FILES),
  };
}

/** The exact text every surface returns. */
export function renderFindReferences(result: FindReferencesResult): string {
  return JSON.stringify(result, null, 2);
}

/** The tool description; `scope` names the commit this surface indexes. */
export function findReferencesDescription(scope: string): string {
  return (
    `Find the files that import one file, read from ${scope} — the import statements ` +
    "themselves, not a text search. With `name`, only the files importing that exported name; " +
    "default and namespace (`*`) imports are included and marked as such, since a namespace " +
    `import reaches every name. At most ${MAX_REFERENCE_FILES} files are returned and \`total\` ` +
    "is the true count. Every result carries an `index` header: an empty list means nothing " +
    "imports the path ONLY when that header shows the path's language indexed and truncated " +
    "false. Each indexed language also carries a `resolution` rate — the share of the " +
    "repository's own imports the index could place — so a rate below 1 means some importers " +
    "are missing. A path the index does not hold comes back as known: false, with the reason."
  );
}
