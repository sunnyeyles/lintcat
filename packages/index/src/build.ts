/**
 * The repository index: a pure function over an in-memory file map, so it can
 * be tested with inline fixtures and reused unchanged anywhere the files come from.
 */
import { parseImports, type ImportedName } from "#src/imports";
import {
  INDEXED_LANGUAGES,
  summariseLanguages,
  languageOf,
  type LanguageCoverage,
} from "#src/languages";
import { coveredSourcePaths } from "#src/pairing";
import { resolveRelativeImport } from "#src/resolve";
import { classifyFileRole, type FileRole } from "#src/roles";

/** One file at the indexed commit. */
export interface IndexedFile {
  readonly path: string;
  readonly role: FileRole;
  readonly language: string;
  /** Distinct files importing this one, resolved. */
  readonly importerCount: number;
  /** The test covering this source file, when one matches a convention. */
  readonly coveredBy?: string;
  /** The source file this test covers, when one matches a convention. */
  readonly covers?: string;
}

/** One import statement, resolved to a file in the tree or to nothing. */
export interface ImportEdge {
  /** The file the statement is written in. */
  readonly from: string;
  /** The specifier exactly as written. */
  readonly specifier: string;
  /** Absent when the specifier resolves to nothing this index understands. */
  readonly to?: string;
  readonly line: number;
  readonly names: readonly ImportedName[];
}

/** Everything the agents can be told about the repository at one commit. */
export interface RepositoryIndex {
  /** The commit the index was built from — always a pull request's base. */
  readonly sha: string;
  /** True when files are missing because the archive hit a cap. */
  readonly truncated: boolean;
  readonly files: ReadonlyMap<string, IndexedFile>;
  readonly coverage: readonly LanguageCoverage[];
  /** Every import parsed, unresolved ones included. */
  readonly edges: readonly ImportEdge[];
  /** Resolved target path to the edges pointing at it. */
  readonly importers: ReadonlyMap<string, readonly ImportEdge[]>;
}

export interface RepositoryIndexInput {
  sha: string;
  /** Repository-relative path to contents, as the archive read them. */
  files: ReadonlyMap<string, string>;
  truncated?: boolean | undefined;
}

type MutableIndexedFile = {
  -readonly [Key in keyof IndexedFile]: IndexedFile[Key];
};

/** Pairs each test with the first source path its name could refer to. */
function pairTestsWithSources(files: Map<string, MutableIndexedFile>): void {
  for (const file of files.values()) {
    if (file.role !== "test") {
      continue;
    }
    const covered = coveredSourcePaths(file.path).find(
      (candidate) => files.get(candidate)?.role === "source",
    );
    if (covered === undefined) {
      continue;
    }
    file.covers = covered;
    const source = files.get(covered);
    if (source !== undefined) {
      source.coveredBy ??= file.path;
    }
  }
}

/** Parses every indexed-language file and resolves what it can. */
function readImports(
  input: RepositoryIndexInput,
  files: ReadonlyMap<string, MutableIndexedFile>,
): { edges: ImportEdge[]; importers: Map<string, ImportEdge[]> } {
  const edges: ImportEdge[] = [];
  const importers = new Map<string, ImportEdge[]>();
  const exists = (path: string): boolean => files.has(path);

  for (const file of files.values()) {
    const contents = input.files.get(file.path);
    if (contents === undefined || !INDEXED_LANGUAGES.has(file.language)) {
      continue;
    }
    for (const parsed of parseImports(contents)) {
      const to = resolveRelativeImport(file.path, parsed.specifier, exists);
      const edge: ImportEdge = {
        from: file.path,
        specifier: parsed.specifier,
        line: parsed.line,
        names: parsed.names,
        ...(to === undefined ? {} : { to }),
      };
      edges.push(edge);
      if (to !== undefined && to !== file.path) {
        importers.set(to, [...(importers.get(to) ?? []), edge]);
      }
    }
  }
  return { edges, importers };
}

/** Builds the index. Paths are sorted, so the same tree always indexes alike. */
export function buildRepositoryIndex(
  input: RepositoryIndexInput,
): RepositoryIndex {
  const files = new Map<string, MutableIndexedFile>();
  for (const path of [...input.files.keys()].sort()) {
    files.set(path, {
      path,
      role: classifyFileRole(path),
      language: languageOf(path),
      importerCount: 0,
    });
  }
  pairTestsWithSources(files);
  const { edges, importers } = readImports(input, files);
  for (const [path, pointing] of importers) {
    const file = files.get(path);
    if (file !== undefined) {
      file.importerCount = new Set(pointing.map((edge) => edge.from)).size;
    }
  }

  return {
    sha: input.sha,
    truncated: input.truncated ?? false,
    files,
    coverage: summariseLanguages(
      [...files.values()].map((file) => file.language),
    ),
    edges,
    importers,
  };
}
