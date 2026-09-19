/**
 * Where a relative import specifier points. Nothing else resolves yet:
 * an alias, a bare package name or a miss stays an unresolved edge.
 */

/** Tried in order for an extensionless specifier and for `index` files. */
const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
];

/** A written `.js` is a TypeScript source on disk under NodeNext. */
const TYPESCRIPT_FOR = new Map<string, readonly string[]>([
  ["js", ["ts", "tsx"]],
  ["jsx", ["tsx"]],
  ["mjs", ["mts"]],
  ["cjs", ["cts"]],
]);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1);
}

function withExtension(path: string, extension: string): string {
  return `${path.slice(0, path.lastIndexOf("."))}.${extension}`;
}

function join(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

/** The specifier applied to the importing file's directory, or undefined
 * when it climbs above the repository root. */
function normalise(fromDirectory: string, specifier: string): string | undefined {
  const segments = fromDirectory === "" ? [] : fromDirectory.split("/");
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.pop() === undefined) {
        return undefined;
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/** Every path the specifier could mean, in the order TypeScript tries them. */
function candidates(base: string): string[] {
  const paths = base === "" ? [] : [base];
  const extension = extensionOf(base);
  const typescript = TYPESCRIPT_FOR.get(extension);
  if (typescript !== undefined) {
    paths.push(...typescript.map((swap) => withExtension(base, swap)));
  } else if (!SOURCE_EXTENSIONS.includes(extension)) {
    paths.push(...SOURCE_EXTENSIONS.map((suffix) => `${base}.${suffix}`));
  }
  paths.push(
    ...SOURCE_EXTENSIONS.map((suffix) => join(base, `index.${suffix}`)),
  );
  return paths;
}

/** True for the only specifiers this resolver claims to understand. */
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
  const slash = fromPath.lastIndexOf("/");
  const base = normalise(slash < 0 ? "" : fromPath.slice(0, slash), specifier);
  if (base === undefined) {
    return undefined;
  }
  return candidates(base).find(exists);
}
