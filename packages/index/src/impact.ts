/** A pull request's blast radius over the base index: who depends on what it changed. */
import type { IndexedFile, RepositoryIndex } from "#src/build";
import { collectEntryPoints, isEntryPoint } from "#src/entry-points";
import { INDEXED_LANGUAGES, languageOf } from "#src/languages";
import { coveredSourcePaths } from "#src/pairing";
import { classifyFileRole, type FileRole } from "#src/roles";
import { packageOf } from "#src/workspace";

/** Paths returned per list; `counts` carries the true totals. */
export const MAX_IMPACT_FILES = 200;

/** Importer hops followed from a changed file; 1 is its direct importers. */
const MAX_IMPACT_DEPTH = 3;

const MAX_HUBS = 3;

/** One file a pull request touched; a review record's changed file fits as is. */
export interface ImpactChange {
  readonly path: string;
  readonly status: "added" | "modified" | "removed" | "renamed";
  /** The base path of a renamed file. */
  readonly previousPath?: string | undefined;
}

/** An import at the base commit naming a path the pull request removes or renames away. */
export interface BrokenImport {
  readonly from: string;
  readonly to: string;
  readonly line: number;
}

export interface ImpactHub {
  readonly path: string;
  readonly dependents: number;
}

export interface ImpactCounts {
  readonly direct: number;
  readonly transitive: number;
  readonly entryPoints: number;
  readonly untested: number;
  readonly inCycle: number;
  readonly brokenImporters: number;
}

export interface Impact {
  /** Source files importing a changed file, changed files excluded. */
  readonly direct: readonly string[];
  /** Source files within MAX_IMPACT_DEPTH importer hops, direct ones included. */
  readonly transitive: readonly string[];
  readonly packages: readonly string[];
  readonly entryPoints: readonly string[];
  readonly untested: readonly string[];
  readonly inCycle: readonly string[];
  readonly brokenImporters: readonly BrokenImport[];
  /** The graph cannot see everything: a truncated index or an unparsed source language. */
  readonly partial: boolean;
  readonly hubs: readonly ImpactHub[];
  readonly counts: ImpactCounts;
}

interface Change {
  readonly path: string;
  readonly status: ImpactChange["status"];
  /** Where the file sits at the base commit, absent for an added one. */
  readonly base?: string;
  readonly role: FileRole;
  readonly file?: IndexedFile;
}

function changesOf(
  index: RepositoryIndex,
  changedFiles: readonly ImpactChange[],
): Change[] {
  return changedFiles.map(({ path, status, previousPath }) => {
    const base =
      status === "added"
        ? undefined
        : status === "renamed"
          ? (previousPath ?? path)
          : path;
    const file = base === undefined ? undefined : index.files.get(base);
    return {
      path,
      status,
      role: classifyFileRole(path),
      ...(base === undefined ? {} : { base }),
      ...(file === undefined ? {} : { file }),
    };
  });
}

/** Base paths the pull request removes or renames away, unless something takes their place. */
function goneOf(changes: readonly Change[]): Set<string> {
  const present = new Set(
    changes
      .filter((change) => change.status !== "removed")
      .map((change) => change.path),
  );
  return new Set(
    changes
      .filter(
        (change) => change.status === "removed" || change.status === "renamed",
      )
      .flatMap((change) => (change.base === undefined ? [] : [change.base]))
      .filter((base) => !present.has(base)),
  );
}

function importerPaths(index: RepositoryIndex, path: string): Set<string> {
  return new Set((index.importers.get(path) ?? []).map((edge) => edge.from));
}

/** Source importers of `start` within the depth cap, by breadth-first search. */
function dependentsOf(
  index: RepositoryIndex,
  start: string,
  changed: ReadonlySet<string>,
): Set<string> {
  const seen = new Set([start]);
  let frontier = [start];
  for (let depth = 0; depth < MAX_IMPACT_DEPTH; depth += 1) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const from of importerPaths(index, path)) {
        if (!seen.has(from) && index.files.get(from)?.role === "source") {
          seen.add(from);
          next.push(from);
        }
      }
    }
    frontier = next;
  }
  return new Set([...seen].filter((path) => !changed.has(path)));
}

const byPath = (a: string, b: string): number => a.localeCompare(b);

function capped(paths: Iterable<string>): string[] {
  return [...new Set(paths)].sort(byPath).slice(0, MAX_IMPACT_FILES);
}

/** Covered by a base test the pull request keeps, or by a test it adds or touches. */
function isTested(
  change: Change,
  changedTests: readonly string[],
  gone: ReadonlySet<string>,
): boolean {
  const coveredBy = change.file?.coveredBy;
  if (coveredBy !== undefined && !gone.has(coveredBy)) {
    return true;
  }
  return changedTests.some((test) =>
    coveredSourcePaths(test).includes(change.path),
  );
}

function brokenImportsOf(
  index: RepositoryIndex,
  gone: ReadonlySet<string>,
): BrokenImport[] {
  return [...gone]
    .flatMap((to) =>
      (index.importers.get(to) ?? []).map((edge) => ({
        from: edge.from,
        to,
        line: edge.line,
      })),
    )
    .filter((edge) => !gone.has(edge.from))
    .sort(
      (a, b) => byPath(a.from, b.from) || byPath(a.to, b.to) || a.line - b.line,
    );
}

/** What the changed files reach in the base index; pure, so one input always answers alike. */
export function computeImpact(
  index: RepositoryIndex,
  changedFiles: readonly ImpactChange[],
): Impact {
  const changes = changesOf(index, changedFiles);
  const changed = new Set(
    changes.flatMap((change) =>
      change.base === undefined ? [change.path] : [change.path, change.base],
    ),
  );
  const gone = goneOf(changes);

  const dependentsByChange = changes.map((change) =>
    change.base === undefined
      ? new Set<string>()
      : dependentsOf(index, change.base, changed),
  );
  const transitive = new Set(dependentsByChange.flatMap((set) => [...set]));
  const direct = new Set(
    changes.flatMap((change) =>
      change.base === undefined
        ? []
        : [...importerPaths(index, change.base)].filter((from) =>
            transitive.has(from),
          ),
    ),
  );

  const sources = changes.filter((change) => change.role === "source");
  const entries = collectEntryPoints(index.workspace, (path) =>
    index.files.has(path),
  );
  const entryPoints = new Set([
    ...[...transitive].filter((path) => isEntryPoint(path, "source", entries)),
    ...sources.flatMap((change) =>
      [change.path, change.base].filter(
        (path): path is string =>
          path !== undefined && isEntryPoint(path, "source", entries),
      ),
    ),
  ]);

  const changedTests = changes
    .filter((change) => change.role === "test" && change.status !== "removed")
    .map((change) => change.path);
  const untested = sources
    .filter((change) => change.status !== "removed")
    .filter((change) => !isTested(change, changedTests, gone))
    .map((change) => change.path);
  const inCycle = changes
    .filter((change) => change.file?.inCycle === true)
    .map((change) => change.path);
  const brokenImporters = brokenImportsOf(index, gone);

  const packages = new Set(
    [...changed, ...transitive]
      .map((path) => packageOf(index.workspace, path))
      .filter((name): name is string => name !== undefined),
  );

  const hubs = changes
    .map((change, at) => ({
      path: change.path,
      dependents: dependentsByChange[at]!.size,
    }))
    .filter((hub) => hub.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents || byPath(a.path, b.path))
    .slice(0, MAX_HUBS);

  return {
    direct: capped(direct),
    transitive: capped(transitive),
    packages: [...packages].sort(byPath),
    entryPoints: capped(entryPoints),
    untested: capped(untested),
    inCycle: capped(inCycle),
    brokenImporters: brokenImporters.slice(0, MAX_IMPACT_FILES),
    partial:
      index.truncated ||
      sources.some(
        (change) => !INDEXED_LANGUAGES.has(languageOf(change.path)),
      ),
    hubs,
    counts: {
      direct: direct.size,
      transitive: transitive.size,
      entryPoints: entryPoints.size,
      untested: new Set(untested).size,
      inCycle: new Set(inCycle).size,
      brokenImporters: brokenImporters.length,
    },
  };
}
