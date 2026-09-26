/** Repository-relative path arithmetic, shared by the resolver and the manifests. */

/** Tried in order for an extensionless specifier and for `index` files. */
export const MODULE_EXTENSIONS: readonly string[] = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
];

/** Every extension this index reads as source, the scripting languages included. */
export const SOURCE_EXTENSIONS: readonly string[] = [
  ...MODULE_EXTENSIONS,
  "py",
  "go",
  "rb",
];

export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function extensionOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1);
}

/** The base name with its `last` extension or `all` of them dropped; a leading dot is kept. */
export function stemOf(path: string, extensions: "last" | "all"): string {
  const base = basenameOf(path);
  const dot =
    extensions === "last" ? base.lastIndexOf(".") : base.indexOf(".", 1);
  return dot <= 0 ? base : base.slice(0, dot);
}

export function directorySegments(path: string): string[] {
  return path.split("/").slice(0, -1);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function globSegmentSource(segment: string): string {
  let source = "";
  for (let at = 0; at < segment.length; at += 1) {
    const char = segment[at]!;
    if (char === "\\" && at + 1 < segment.length) {
      at += 1;
      source += escapeRegExp(segment[at]!);
    } else if (char === "*") {
      source += "[^/]*";
      while (segment[at + 1] === "*") {
        at += 1;
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return source;
}

/** Unanchored regex source for a `/`-separated glob; only a whole `**` segment crosses directories. */
export function globSource(glob: string): string {
  const segments = glob.split("/");
  return segments
    .map((segment, at) => {
      const last = at === segments.length - 1;
      if (segment === "**") {
        return last ? ".*" : "(?:.*/)?";
      }
      return globSegmentSource(segment) + (last ? "" : "/");
    })
    .join("");
}

/** `specifier` applied to `directory`, or undefined above the repository root. */
export function joinPath(
  directory: string,
  specifier: string,
): string | undefined {
  const segments = directory === "" ? [] : directory.split("/");
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

/** Every ancestor directory of `path`, nearest first, ending at the root. */
export function ancestorDirectories(path: string): string[] {
  const directories: string[] = [];
  let directory = directoryOf(path);
  for (;;) {
    directories.push(directory);
    if (directory === "") {
      return directories;
    }
    directory = directoryOf(directory);
    if (directories.at(-1) === directory) {
      return directories;
    }
  }
}
