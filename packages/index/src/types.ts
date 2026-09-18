/**
 * The repository index contract (docs/specs/repo-index.md). Layer A is the
 * map: packages, file roles, test coverage, ownership. No source text, ever.
 */

export type FileRole =
  | "source"
  | "test"
  | "config"
  | "migration"
  | "generated"
  | "docs"
  | "vendored"
  | "asset";

export const FILE_ROLES: readonly FileRole[] = [
  "source",
  "test",
  "config",
  "migration",
  "generated",
  "docs",
  "vendored",
  "asset",
];

/** One workspace package, module, or crate found from a manifest. */
export interface PackageRecord {
  /** The manifest's own name, or the root directory when it has none. */
  name: string;
  /** Repository-relative directory, "" for the repository root. */
  root: string;
  /** Repository-relative entry files named by the manifest. */
  entryPoints: readonly string[];
  /** Names of other PackageRecords this one depends on. */
  dependsOn: readonly string[];
}

export interface FileRecord {
  path: string;
  /** PackageRecord.name of the innermost package containing the file, if any. */
  package: string | null;
  role: FileRole;
  /** Lower-case language id from the extension ("typescript"), or null. */
  language: string | null;
  /** CODEOWNERS owners applying to the path, most specific rule wins. */
  owners: readonly string[];
}

/** A test file and the source file it covers, by naming convention. */
export interface TestEdge {
  test: string;
  source: string;
}

export interface LayerACoverage {
  files: number;
  /** The listing was cut short; every answer may be missing files. */
  truncated: boolean;
  /** File count per language id. */
  languages: Readonly<Record<string, number>>;
  /** Manifest kinds found, e.g. "pnpm-workspace", "go.mod". */
  manifests: readonly string[];
}

export interface LayerAIndex {
  version: 1;
  sha: string;
  builtAt: string;
  packages: readonly PackageRecord[];
  files: readonly FileRecord[];
  tests: readonly TestEdge[];
  coverage: LayerACoverage;
}

/** Where an index is built from: a file listing plus reads of a few manifests. */
export interface FileSource {
  sha: string;
  listPaths(): Promise<{ paths: readonly string[]; truncated: boolean }>;
  /** Undefined when the file does not exist. */
  read(path: string): Promise<string | undefined>;
}

/** What `describe_area` returns; `known` is false for a path the index lacks. */
export interface AreaDescription {
  path: string;
  known: boolean;
  package: PackageRecord | null;
  role: FileRole | null;
  language: string | null;
  owners: readonly string[];
  /** Test files covering this path. */
  tests: readonly string[];
  /** Source files this path covers, when it is itself a test. */
  covers: readonly string[];
  /** Other files in the same directory, capped; `siblingsTotal` is exact. */
  siblings: readonly string[];
  siblingsTotal: number;
}

export interface IndexStatus {
  sha: string;
  builtAt: string;
  coverage: LayerACoverage;
}

/** The read seam the tools use. Absent mode is a missing RepositoryIndex, not a method. */
export interface RepositoryIndex {
  status(): Promise<IndexStatus>;
  describeArea(path: string): Promise<AreaDescription>;
}

/** Other files listed by `describeArea`, per directory. */
export const MAX_SIBLINGS = 30;

/** One CODEOWNERS line: a gitignore-like pattern and the owners it grants. */
export interface OwnerRule {
  pattern: string;
  owners: readonly string[];
}
