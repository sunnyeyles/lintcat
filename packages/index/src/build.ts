/**
 * The repository index: a pure function over an in-memory file map, so it can
 * be tested with inline fixtures and reused unchanged anywhere the files come from.
 */
import {
  isEnvExamplePath,
  readDependencies,
  readEnvExample,
  type DeclaredDependency,
  type EnvExampleEntry,
} from "#src/config-drift";
import { nodesInCycles } from "#src/cycles";
import { isDocPath, readDoc, type IndexedDoc } from "#src/docs";
import { collectEntryPoints, isEntryPoint } from "#src/entry-points";
import { parseImports, type ImportedName } from "#src/imports";
import { findLintConfigs, type LintConfig } from "#src/lint-config";
import {
  INDEXED_LANGUAGES,
  summariseLanguages,
  languageOf,
  type LanguageCoverage,
} from "#src/languages";
import { coveredSourcePaths } from "#src/pairing";
import { basenameOf } from "#src/paths";
import { createImportResolver } from "#src/resolve";
import { classifyFileRole, type FileRole } from "#src/roles";
import { findRuleDocs, type RuleDoc } from "#src/rule-docs";
import {
  packageOf,
  readWorkspace,
  type WorkspaceModel,
  type WorkspacePackage,
} from "#src/workspace";

/** One file at the indexed commit. */
export interface IndexedFile {
  readonly path: string;
  readonly role: FileRole;
  readonly language: string;
  readonly lineCount: number;
  /** The nearest named package.json above it, absent when there is none. */
  readonly package?: string;
  /** Distinct files importing this one, resolved. */
  readonly importerCount: number;
  /** In a cycle of two or more files over the resolved edges; a self-import is not. */
  readonly inCycle: boolean;
  /** A source file nobody imports and nothing outside the graph runs. */
  readonly dead: boolean;
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
  /** The workspace's own packages, by root; empty outside a monorepo. */
  readonly packages: readonly WorkspacePackage[];
  readonly coverage: readonly LanguageCoverage[];
  /** Every import parsed, unresolved ones included. */
  readonly edges: readonly ImportEdge[];
  /** Resolved target path to the edges pointing at it. */
  readonly importers: ReadonlyMap<string, readonly ImportEdge[]>;
  /** Manifests and aliases, kept so imports written at HEAD resolve alike. */
  readonly workspace: WorkspaceModel;
  /** Every Markdown file, by path: headings, links and mentions. */
  readonly docs: ReadonlyMap<string, IndexedDoc>;
  /** Variables declared in `.env.example` and its equivalents. */
  readonly envExamples: readonly EnvExampleEntry[];
  /** Every dependency entry of every package.json outside vendored and generated trees. */
  readonly dependencies: readonly DeclaredDependency[];
  /** CLAUDE.md, AGENTS.md and CONTRIBUTING.md files, shallowest first. */
  readonly ruleDocs: readonly RuleDoc[];
  /** Linter, formatter and typecheck configuration, shallowest first. */
  readonly lintConfigs: readonly LintConfig[];
}

export interface RepositoryIndexInput {
  sha: string;
  /** Repository-relative path to contents, as the archive read them. */
  files: ReadonlyMap<string, string>;
  truncated?: boolean | undefined;
  /** Paths the archive skipped for size; only an indexed one hides a graph edge. */
  oversized?: readonly string[] | undefined;
}

function hidesIndexedSource(paths: readonly string[] | undefined): boolean {
  return (paths ?? []).some((path) =>
    INDEXED_LANGUAGES.has(languageOf(path)),
  );
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

interface ImportGraph {
  edges: ImportEdge[];
  importers: Map<string, ImportEdge[]>;
  /** Internal and resolved counts per language, for the resolution rate. */
  tally: Map<string, { internal: number; resolved: number }>;
}

/** Parses every indexed-language file and resolves what it can. */
function readImports(
  input: RepositoryIndexInput,
  files: ReadonlyMap<string, MutableIndexedFile>,
  workspace: WorkspaceModel,
): ImportGraph {
  const edges: ImportEdge[] = [];
  const importers = new Map<string, ImportEdge[]>();
  const tally = new Map<string, { internal: number; resolved: number }>();
  const resolve = createImportResolver(workspace, (path) => files.has(path));

  for (const file of files.values()) {
    const contents = input.files.get(file.path);
    if (contents === undefined || !INDEXED_LANGUAGES.has(file.language)) {
      continue;
    }
    let counted = tally.get(file.language);
    if (counted === undefined) {
      counted = { internal: 0, resolved: 0 };
      tally.set(file.language, counted);
    }
    for (const parsed of parseImports(contents)) {
      const { path: to, internal } = resolve(file.path, parsed.specifier);
      counted.internal += internal ? 1 : 0;
      counted.resolved += to === undefined ? 0 : 1;
      const edge: ImportEdge = {
        from: file.path,
        specifier: parsed.specifier,
        line: parsed.line,
        names: parsed.names,
        ...(to === undefined ? {} : { to }),
      };
      edges.push(edge);
      if (to !== undefined && to !== file.path) {
        const pointing = importers.get(to);
        if (pointing === undefined) {
          importers.set(to, [edge]);
        } else {
          pointing.push(edge);
        }
      }
    }
  }
  return { edges, importers, tally };
}

/** The resolved edges as an adjacency list, the graph the cycles run over. */
function adjacencyOf(
  edges: readonly ImportEdge[],
): Map<string, readonly string[]> {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.to === undefined) {
      continue;
    }
    const targets = graph.get(edge.from);
    if (targets === undefined) {
      graph.set(edge.from, [edge.to]);
    } else {
      targets.push(edge.to);
    }
  }
  return graph;
}

/** Sets `inCycle` and `dead`, once the importer counts are known. */
function flagFiles(
  files: Map<string, MutableIndexedFile>,
  edges: readonly ImportEdge[],
  workspace: WorkspaceModel,
): void {
  const cycling = nodesInCycles(adjacencyOf(edges));
  const entries = collectEntryPoints(workspace, (path) => files.has(path));
  for (const file of files.values()) {
    file.inCycle = cycling.has(file.path);
    file.dead =
      file.role === "source" &&
      file.importerCount === 0 &&
      !isEntryPoint(file.path, file.role, entries);
  }
}

function countLines(contents: string): number {
  if (contents === "") {
    return 0;
  }
  const breaks = contents.split("\n").length - 1;
  return contents.endsWith("\n") ? breaks : breaks + 1;
}

/** Builds the index. Paths are sorted, so the same tree always indexes alike. */
export function buildRepositoryIndex(
  input: RepositoryIndexInput,
): RepositoryIndex {
  const workspace = readWorkspace(input.files);
  const files = new Map<string, MutableIndexedFile>();
  for (const [path, contents] of [...input.files].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const owner = packageOf(workspace, path);
    files.set(path, {
      path,
      role: classifyFileRole(path),
      language: languageOf(path),
      lineCount: countLines(contents),
      importerCount: 0,
      inCycle: false,
      dead: false,
      ...(owner === undefined ? {} : { package: owner }),
    });
  }
  pairTestsWithSources(files);
  const { edges, importers, tally } = readImports(input, files, workspace);
  for (const [path, pointing] of importers) {
    const file = files.get(path);
    if (file !== undefined) {
      file.importerCount = new Set(pointing.map((edge) => edge.from)).size;
    }
  }
  flagFiles(files, edges, workspace);
  const docs = new Map<string, IndexedDoc>();
  const envExamples: EnvExampleEntry[] = [];
  const dependencies: DeclaredDependency[] = [];
  for (const file of files.values()) {
    const contents = input.files.get(file.path);
    if (contents === undefined) {
      continue;
    }
    if (isDocPath(file.path)) {
      docs.set(file.path, readDoc(file.path, contents));
    } else if (isEnvExamplePath(file.path)) {
      envExamples.push(...readEnvExample(file.path, contents));
    } else if (
      basenameOf(file.path) === "package.json" &&
      file.role !== "vendored" &&
      file.role !== "generated"
    ) {
      dependencies.push(...readDependencies(file.path, contents));
    }
  }

  return {
    sha: input.sha,
    truncated: (input.truncated ?? false) || hidesIndexedSource(input.oversized),
    files,
    packages: workspace.packages,
    coverage: summariseLanguages(
      [...files.values()].map((file) => file.language),
      tally,
    ),
    edges,
    importers,
    workspace,
    docs,
    envExamples,
    dependencies,
    ruleDocs: findRuleDocs(input.files),
    lintConfigs: findLintConfigs(input.files),
  };
}
