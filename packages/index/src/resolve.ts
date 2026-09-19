/** Where an import specifier points: a relative path, a `#` import map, a
 * tsconfig alias, a workspace package, or nothing this index understands. */
import { resolveExportsField, resolveImportsField } from "#src/manifests";
import {
  directoryOf,
  extensionOf,
  joinPath,
  MODULE_EXTENSIONS,
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

/** The alias whose pattern matches longest, with what its `*` captured. */
function matchAlias(
  aliases: readonly { pattern: string; targets: readonly string[] }[],
  specifier: string,
): { targets: readonly string[]; capture: string } | undefined {
  let best: { targets: readonly string[]; capture: string; head: number } | undefined;
  for (const { pattern, targets } of aliases) {
    const star = pattern.indexOf("*");
    if (star < 0) {
      if (pattern === specifier && (best === undefined || pattern.length > best.head)) {
        best = { targets, capture: "", head: pattern.length };
      }
      continue;
    }
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    if (
      !specifier.startsWith(head) ||
      !specifier.endsWith(tail) ||
      specifier.length < head.length + tail.length
    ) {
      continue;
    }
    if (best === undefined || head.length > best.head) {
      best = {
        targets,
        capture: specifier.slice(head.length, specifier.length - tail.length),
        head: head.length,
      };
    }
  }
  return best === undefined
    ? undefined
    : { targets: best.targets, capture: best.capture };
}

/** Tried in one order: relative path, `#` import map, tsconfig `paths`,
 * workspace package name, then nothing. A bare miss is third-party. */
export function createImportResolver(
  workspace: WorkspaceModel,
  exists: (path: string) => boolean,
): (fromPath: string, specifier: string) => ResolvedImport {
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
      return resolved(resolveRelativeImport(fromPath, specifier, exists));
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

    const aliases = nearestFor(workspace.aliases, fromPath);
    const matched =
      aliases === undefined ? undefined : matchAlias(aliases, specifier);
    if (matched !== undefined) {
      return resolved(firstExisting("", matched.targets, matched.capture));
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
