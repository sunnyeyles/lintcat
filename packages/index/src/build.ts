/**
 * The repository index: a pure function over an in-memory file map, so it can
 * be tested with inline fixtures and reused unchanged anywhere the files come from.
 */
import { summariseLanguages, languageOf, type LanguageCoverage } from "#src/languages";
import { coveredSourcePaths } from "#src/pairing";
import { classifyFileRole, type FileRole } from "#src/roles";

/** One file at the indexed commit. */
export interface IndexedFile {
  readonly path: string;
  readonly role: FileRole;
  readonly language: string;
  /** The test covering this source file, when one matches a convention. */
  readonly coveredBy?: string;
  /** The source file this test covers, when one matches a convention. */
  readonly covers?: string;
}

/** Everything the agents can be told about the repository at one commit. */
export interface RepositoryIndex {
  /** The commit the index was built from — always a pull request's base. */
  readonly sha: string;
  /** True when files are missing because the archive hit a cap. */
  readonly truncated: boolean;
  readonly files: ReadonlyMap<string, IndexedFile>;
  readonly coverage: readonly LanguageCoverage[];
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
    });
  }
  pairTestsWithSources(files);

  return {
    sha: input.sha,
    truncated: input.truncated ?? false,
    files,
    coverage: summariseLanguages(
      [...files.values()].map((file) => file.language),
    ),
  };
}
