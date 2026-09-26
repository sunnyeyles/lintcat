/**
 * Files something outside the import graph runs or loads. Each rule stands on
 * its own list, so a new framework convention is one entry to add.
 */
import type { PackageManifest } from "#src/manifests";
import {
  directoryOf,
  directorySegments,
  extensionOf,
  joinPath,
  MODULE_EXTENSIONS,
  stemOf,
} from "#src/paths";
import { moduleCandidates } from "#src/resolve";
import type { FileRole } from "#src/roles";
import type { WorkspaceModel } from "#src/workspace";

/** Roles reached by a runner, a tool or a reader, never by an import. */
const ENTRY_ROLES: ReadonlySet<FileRole> = new Set<FileRole>([
  "asset",
  "config",
  "docs",
  "generated",
  "migration",
  "test",
  "vendored",
]);

/** Base names a framework loads by convention: Next.js app router and friends. */
const FRAMEWORK_STEMS: ReadonlySet<string> = new Set([
  "default",
  "error",
  "global-error",
  "instrumentation",
  "layout",
  "loading",
  "middleware",
  "not-found",
  "page",
  "proxy",
  "route",
  "template",
]);

/** Directory names whose files are executed rather than imported. */
const ENTRY_DIRECTORIES: ReadonlySet<string> = new Set(["bin", "scripts"]);

/** What the manifests of one repository say is reachable from outside it. */
export interface EntryPoints {
  /** Files a package.json names through main, module, exports or bin. */
  readonly declared: ReadonlySet<string>;
  /** Directories where an `index` file is a package's own entry. */
  readonly indexDirectories: ReadonlySet<string>;
}

/** Every string in a nested `exports` or `bin` value, conditions included. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringLeaves);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

function manifestTargets(manifest: PackageManifest): string[] {
  return [
    ...(manifest.main === undefined ? [] : [manifest.main]),
    ...(manifest.module === undefined ? [] : [manifest.module]),
    ...stringLeaves(manifest.exports),
    ...stringLeaves(manifest.bin),
  ];
}

/** Reads every manifest in the tree for the files it publishes. */
export function collectEntryPoints(
  workspace: WorkspaceModel,
  exists: (path: string) => boolean,
): EntryPoints {
  const declared = new Set<string>();
  const indexDirectories = new Set<string>();
  for (const manifest of workspace.manifests.values()) {
    indexDirectories.add(manifest.root);
    const source = joinPath(manifest.root, "src");
    if (source !== undefined) {
      indexDirectories.add(source);
    }
    for (const target of manifestTargets(manifest)) {
      const joined = joinPath(manifest.root, target);
      const found =
        joined === undefined
          ? undefined
          : moduleCandidates(joined).find(exists);
      if (found !== undefined) {
        declared.add(found);
      }
    }
  }
  return { declared, indexDirectories };
}

/** True when something other than an import reaches this file. */
export function isEntryPoint(
  path: string,
  role: FileRole,
  entries: EntryPoints,
): boolean {
  if (ENTRY_ROLES.has(role)) {
    return true;
  }
  if (entries.declared.has(path)) {
    return true;
  }
  if (
    directorySegments(path).some((segment) => ENTRY_DIRECTORIES.has(segment))
  ) {
    return true;
  }
  if (!MODULE_EXTENSIONS.includes(extensionOf(path))) {
    return false;
  }
  const stem = stemOf(path, "last").toLowerCase();
  return (
    FRAMEWORK_STEMS.has(stem) ||
    (stem === "index" && entries.indexDirectories.has(directoryOf(path)))
  );
}
