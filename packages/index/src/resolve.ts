/** Where an import specifier points: a relative path, a `#` import map, a
 * tsconfig alias, a workspace package, or nothing this index understands. */
import {
  matchSubpathKey,
  resolveExportsField,
  resolveImportsField,
} from "#src/manifests";
import {
  directoryOf,
  extensionOf,
  joinPath,
  MODULE_EXTENSIONS,
  SOURCE_EXTENSIONS,
} from "#src/paths";
import { nearestFor, type WorkspaceModel } from "#src/workspace";

/** A written `.js` is a TypeScript source on disk under NodeNext. */
const TYPESCRIPT_FOR = new Map<string, readonly string[]>([
  ["js", ["ts", "tsx"]],
  ["jsx", ["tsx"]],
  ["mjs", ["mts"]],
  ["cjs", ["cts"]],
]);

function withExtension(path: string, extension: string): string {
  return `${path.slice(0, path.lastIndexOf("."))}.${extension}`;
}

function join(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

/** Every path the specifier could mean, in the order TypeScript tries them. */
function candidates(base: string): string[] {
  const paths = base === "" ? [] : [base];
  const extension = extensionOf(base);
  const typescript = TYPESCRIPT_FOR.get(extension);
  if (typescript !== undefined) {
    paths.push(...typescript.map((swap) => withExtension(base, swap)));
  } else if (!MODULE_EXTENSIONS.includes(extension)) {
    paths.push(...MODULE_EXTENSIONS.map((suffix) => `${base}.${suffix}`));
  }
  paths.push(
    ...MODULE_EXTENSIONS.map((suffix) => join(base, `index.${suffix}`)),
  );
  return paths;
}

/** True for the only specifiers the relative resolver claims to understand. */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith(".");
}

/** False for `./logo.png` and its kind: an extension no source file carries. */
function namesSource(specifier: string): boolean {
  const extension = extensionOf(specifier);
  return extension === "" || SOURCE_EXTENSIONS.includes(extension);
}

/** The file `specifier` names, or undefined when nothing in the tree matches. */
export function resolveRelativeImport(
  fromPath: string,
  specifier: string,
  exists: (path: string) => boolean,
): string | undefined {
  if (!isRelativeSpecifier(specifier)) {
    return undefined;
  }
  const base = joinPath(directoryOf(fromPath), specifier);
  if (base === undefined) {
    return undefined;
  }
  return candidates(base).find(exists);
}

/** One import specifier, placed in the tree and judged internal or third-party. */
export interface ResolvedImport {
  /** The file it names, absent when nothing in the tree matches. */
  readonly path?: string | undefined;
  /** False only for a bare specifier matching no package, alias or import map. */
  readonly internal: boolean;
}

const THIRD_PARTY: ResolvedImport = { internal: false };

const UNRESOLVED: ResolvedImport = { internal: true };

/** An import of a bundler asset the archive never carried; not the index's to place. */
const OUTSIDE_SOURCE: ResolvedImport = { internal: false };

function resolved(path: string | undefined): ResolvedImport {
  return path === undefined ? UNRESOLVED : { path, internal: true };
}

/** The package name and subpath of a bare specifier, `@scope/name` included. */
function splitBare(
  specifier: string,
): { name: string; subpath: string } | undefined {
  const segments = specifier.split("/");
  const scoped = specifier.startsWith("@");
  if (scoped && segments.length < 2) {
    return undefined;
  }
  const taken = scoped ? 2 : 1;
  const rest = segments.slice(taken).join("/");
  return {
    name: segments.slice(0, taken).join("/"),
    subpath: rest === "" ? "." : `./${rest}`,
  };
}

/** Tried in one order: relative path, `#` import map, tsconfig `paths`,
 * workspace package name, then nothing. A bare miss is third-party. */
export function createImportResolver(
  workspace: WorkspaceModel,
  exists: (path: string) => boolean,
): (fromPath: string, specifier: string) => ResolvedImport {
  const aliasesByDirectory = new Map(
    [...workspace.aliases].map(([directory, declared]) => [
      directory,
      Object.fromEntries(
        declared.map(({ pattern, targets }) => [pattern, targets]),
      ) as Record<string, readonly string[]>,
    ]),
  );

  const firstExisting = (
    base: string,
    targets: readonly string[],
    capture?: string,
  ): string | undefined => {
    for (const target of targets) {
      const filled =
        capture === undefined ? target : target.replaceAll("*", capture);
      const joined = joinPath(base, filled);
      if (joined === undefined) {
        continue;
      }
      const found = candidates(joined).find(exists);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };

  return (fromPath, specifier) => {
    if (isRelativeSpecifier(specifier)) {
      const path = resolveRelativeImport(fromPath, specifier, exists);
      if (path === undefined && !namesSource(specifier)) {
        return OUTSIDE_SOURCE;
      }
      return resolved(path);
    }

    if (specifier.startsWith("#")) {
      const manifest = nearestFor(workspace.manifests, fromPath);
      const targets =
        manifest === undefined
          ? []
          : resolveImportsField(manifest.imports, specifier);
      return resolved(
        manifest === undefined
          ? undefined
          : firstExisting(manifest.root, targets),
      );
    }

    const aliases = nearestFor(aliasesByDirectory, fromPath);
    const matched =
      aliases === undefined ? undefined : matchSubpathKey(aliases, specifier);
    if (matched !== undefined) {
      return resolved(firstExisting("", matched.value, matched.capture));
    }

    const bare = splitBare(specifier);
    const manifest =
      bare === undefined ? undefined : workspace.byName.get(bare.name);
    if (bare === undefined || manifest === undefined) {
      return THIRD_PARTY;
    }
    const targets =
      manifest.exports === undefined
        ? [bare.subpath === "." ? (manifest.main ?? ".") : bare.subpath]
        : resolveExportsField(manifest.exports, bare.subpath);
    return resolved(firstExisting(manifest.root, targets));
  };
}
