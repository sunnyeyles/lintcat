/** A changed file's imports as HEAD writes them, placed in the base tree with the pull request applied. */
import type { RepositoryIndex } from "#src/build";
import { parseImports } from "#src/imports";
import { INDEXED_LANGUAGES, languageOf } from "#src/languages";
import { createImportResolver } from "#src/resolve";

export interface HeadImport {
  readonly specifier: string;
  readonly line: number;
  /** The file it names, absent when nothing in the tree matches. */
  readonly path?: string;
  /** False for a third-party package or an asset outside the source tree. */
  readonly internal: boolean;
}

export interface HeadTree {
  /** HEAD contents of the changed files to resolve, by path. */
  readonly contents: ReadonlyMap<string, string>;
  /** Paths the pull request adds or renames into place. */
  readonly added: ReadonlySet<string>;
  readonly removed: ReadonlySet<string>;
}

/** Only indexed-language files are parsed; the rest have no entry. */
export function resolveHeadImports(
  index: RepositoryIndex,
  head: HeadTree,
): Map<string, HeadImport[]> {
  const exists = (path: string): boolean =>
    !head.removed.has(path) && (index.files.has(path) || head.added.has(path));
  const resolve = createImportResolver(index.workspace, exists);

  const result = new Map<string, HeadImport[]>();
  for (const [from, contents] of head.contents) {
    if (!INDEXED_LANGUAGES.has(languageOf(from))) {
      continue;
    }
    result.set(
      from,
      parseImports(contents).map(({ specifier, line }) => {
        const { path, internal } = resolve(from, specifier);
        return { specifier, line, internal, ...(path === undefined ? {} : { path }) };
      }),
    );
  }
  return result;
}
