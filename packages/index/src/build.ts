/**
 * Layer A: listing plus manifests, nothing parsed. Nothing is excluded —
 * vendored and generated files are counted, so the coverage is honest.
 */
import { languageOf } from "./layer-a/languages.js";
import { CODEOWNERS_PATHS, ownersOf, parseCodeowners } from "./layer-a/owners.js";
import { discoverPackages } from "./layer-a/packages.js";
import { roleOf } from "./layer-a/roles.js";
import { testEdges } from "./layer-a/tests.js";
import type {
  FileRecord,
  FileSource,
  LayerAIndex,
  OwnerRule,
  PackageRecord,
} from "./types.js";

/** The innermost package containing a path: the longest matching root. */
function packageOf(
  path: string,
  packages: readonly PackageRecord[],
): PackageRecord | undefined {
  let best: PackageRecord | undefined;
  for (const record of packages) {
    const contains = record.root === "" || path.startsWith(`${record.root}/`);
    if (!contains) continue;
    if (best === undefined || record.root.length > best.root.length) best = record;
  }
  return best;
}

async function readOwnerRules(
  source: FileSource,
  known: ReadonlySet<string>,
): Promise<OwnerRule[]> {
  for (const path of CODEOWNERS_PATHS) {
    if (!known.has(path)) continue;
    const text = await source.read(path);
    if (text !== undefined) return parseCodeowners(text);
  }
  return [];
}

function countLanguages(
  files: readonly FileRecord[],
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (file.language === null) continue;
    counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

/** Builds the whole of Layer A from one file source. */
export async function buildLayerA(
  source: FileSource,
  now: Date = new Date(),
): Promise<LayerAIndex> {
  const listing = await source.listPaths();
  const paths = [...listing.paths].sort();
  const { packages, manifests } = await discoverPackages(source, paths);
  const rules = await readOwnerRules(source, new Set(paths));

  const files: FileRecord[] = paths.map((path) => {
    const language = languageOf(path);
    return {
      path,
      package: packageOf(path, packages)?.name ?? null,
      role: roleOf(path, language),
      language,
      owners: ownersOf(path, rules),
    };
  });

  return {
    version: 1,
    sha: source.sha,
    builtAt: now.toISOString(),
    packages,
    files,
    tests: testEdges(files),
    coverage: {
      files: files.length,
      truncated: listing.truncated,
      languages: countLanguages(files),
      manifests,
    },
  };
}
