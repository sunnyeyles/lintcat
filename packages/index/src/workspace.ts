/** What the repository's own manifests say about itself: packages and aliases. */
import {
  parseJsonc,
  parseWorkspaceYamlPackages,
  readPackageManifest,
  readPathAliases,
  workspacePatternsOf,
  type PackageManifest,
  type PathAlias,
} from "#src/manifests";
import {
  ancestorDirectories,
  basenameOf,
  directoryOf,
  globSource,
} from "#src/paths";

/** A package the workspace config claims, as the repository overview lists it. */
export interface WorkspacePackage {
  readonly name: string;
  /** The directory holding its package.json, "" at the repository root. */
  readonly root: string;
}

/** Everything the resolver needs to turn a specifier into a repository path. */
export interface WorkspaceModel {
  /** Every package.json in the tree, by the directory holding it. */
  readonly manifests: ReadonlyMap<string, PackageManifest>;
  readonly byName: ReadonlyMap<string, PackageManifest>;
  /** The workspace config's own packages, sorted by root. */
  readonly packages: readonly WorkspacePackage[];
  /** tsconfig `paths`, by the directory of the config that declares them. */
  readonly aliases: ReadonlyMap<string, readonly PathAlias[]>;
}

const WORKSPACE_YAML = "pnpm-workspace.yaml";

/** Directories whose manifests describe someone else's code, not this repository. */
const IGNORED_SEGMENTS = new Set(["node_modules", "bower_components", "vendor"]);

function isIgnored(path: string): boolean {
  return path.split("/").some((segment) => IGNORED_SEGMENTS.has(segment));
}

/** One workspace pattern as a regular expression over a package directory. */
function patternToRegExp(pattern: string): RegExp {
  return new RegExp(`^${globSource(pattern)}$`);
}

/** Matches a directory against pnpm's include/exclude pattern list. */
function matcherFor(patterns: readonly string[]): (root: string) => boolean {
  const include = patterns
    .filter((pattern) => !pattern.startsWith("!"))
    .map((pattern) => patternToRegExp(pattern.replace(/\/$/, "")));
  const exclude = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => patternToRegExp(pattern.slice(1).replace(/\/$/, "")));
  return (root) =>
    include.some((expression) => expression.test(root)) &&
    !exclude.some((expression) => expression.test(root));
}

/** The workspace patterns, from pnpm's manifest first and npm's `workspaces` after. */
function workspacePatterns(files: ReadonlyMap<string, string>): string[] {
  const yaml = files.get(WORKSPACE_YAML);
  const fromPnpm =
    yaml === undefined ? [] : parseWorkspaceYamlPackages(yaml);
  if (fromPnpm.length > 0) {
    return fromPnpm;
  }
  const root = files.get("package.json");
  return root === undefined ? [] : workspacePatternsOf(parseJsonc(root));
}

/** Reads the manifests and tsconfigs of one file map into a resolvable model. */
export function readWorkspace(
  files: ReadonlyMap<string, string>,
): WorkspaceModel {
  const manifests = new Map<string, PackageManifest>();
  const byName = new Map<string, PackageManifest>();
  const configPaths: string[] = [];

  for (const path of [...files.keys()].sort()) {
    if (isIgnored(path)) {
      continue;
    }
    const base = basenameOf(path);
    if (base === "package.json") {
      const manifest = readPackageManifest(
        directoryOf(path),
        files.get(path)!,
      );
      if (manifest !== undefined) {
        manifests.set(manifest.root, manifest);
        if (manifest.name !== undefined && !byName.has(manifest.name)) {
          byName.set(manifest.name, manifest);
        }
      }
      continue;
    }
    if (base === "tsconfig.json" || base === "jsconfig.json") {
      configPaths.push(path);
    }
  }

  const packageRoots = new Map(
    [...byName].map(([name, manifest]) => [name, manifest.root] as const),
  );
  const aliases = new Map<string, readonly PathAlias[]>();
  for (const path of configPaths) {
    const directory = directoryOf(path);
    if (aliases.has(directory)) {
      continue;
    }
    const declared = readPathAliases(path, files, packageRoots);
    if (declared.length > 0) {
      aliases.set(directory, declared);
    }
  }

  const matches = matcherFor(workspacePatterns(files));
  const packages = [...manifests.values()]
    .filter(
      (manifest): manifest is PackageManifest & { name: string } =>
        manifest.name !== undefined && matches(manifest.root),
    )
    .map((manifest) => ({ name: manifest.name, root: manifest.root }))
    .sort((a, b) => a.root.localeCompare(b.root));

  return { manifests, byName, packages, aliases };
}

/** The entry of `byDirectory` nearest above `path`, walking to the root. */
export function nearestFor<Value>(
  byDirectory: ReadonlyMap<string, Value>,
  path: string,
): Value | undefined {
  for (const directory of ancestorDirectories(path)) {
    const found = byDirectory.get(directory);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** The package a file belongs to: the nearest manifest above it that has a name. */
export function packageOf(
  workspace: WorkspaceModel,
  path: string,
): string | undefined {
  for (const directory of ancestorDirectories(path)) {
    const name = workspace.manifests.get(directory)?.name;
    if (name !== undefined) {
      return name;
    }
  }
  return undefined;
}
