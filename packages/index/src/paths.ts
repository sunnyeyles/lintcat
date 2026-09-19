/** Repository-relative path arithmetic, shared by the resolver and the manifests. */

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1);
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
