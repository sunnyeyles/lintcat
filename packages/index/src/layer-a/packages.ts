/**
 * Packages from manifests alone: pnpm/npm workspaces, go.work/go.mod,
 * pyproject.toml, Cargo.toml. Nothing but a manifest is ever read.
 */
import { parse as parseYaml } from "yaml";

import type { FileSource, PackageRecord } from "../types.js";

/** Manifest reads per build; a pathological repository stops here. */
export const MAX_MANIFEST_READS = 200;

export type ManifestKind =
  | "pnpm-workspace"
  | "package.json"
  | "go.mod"
  | "go.work"
  | "pyproject"
  | "cargo";

const MANIFEST_ORDER: readonly ManifestKind[] = [
  "pnpm-workspace",
  "package.json",
  "go.mod",
  "go.work",
  "pyproject",
  "cargo",
];

const VENDOR_SEGMENTS = new Set(["node_modules", "vendor", "third_party"]);

interface Found {
  record: PackageRecord;
  declaredDependencies: readonly string[];
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function joinPath(root: string, relative: string): string {
  return root === "" ? relative : `${root}/${relative}`;
}

function isVendored(path: string): boolean {
  return path.split("/").some((segment) => VENDOR_SEGMENTS.has(segment));
}

/** The manifest's own name, or its directory when it declares none. */
function fallbackName(root: string): string {
  return root === "" ? "." : root;
}

function escapeSegment(part: string): string {
  return part
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
}

/** Workspace globs: `*` stays inside one segment, `**` crosses them. */
function globToRegExp(glob: string): RegExp {
  const parts = glob.replace(/^\.\//, "").replace(/\/+$/, "").split("/");
  let source = "";
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (part === "**") {
      source += last ? "[^/]+(?:/[^/]+)*" : "(?:[^/]+/)*";
    } else {
      source += escapeSegment(part) + (last ? "" : "/");
    }
  });
  return new RegExp(`^${source}$`);
}

function matchDirectories(
  globs: readonly string[],
  directories: readonly string[],
): string[] {
  const positive = globs.filter((glob) => !glob.startsWith("!")).map(globToRegExp);
  const negative = globs
    .filter((glob) => glob.startsWith("!"))
    .map((glob) => globToRegExp(glob.slice(1)));
  return directories.filter(
    (directory) =>
      positive.some((pattern) => pattern.test(directory)) &&
      !negative.some((pattern) => pattern.test(directory)),
  );
}

function manifestDirectories(
  paths: readonly string[],
  filename: string,
): string[] {
  return paths
    .filter(
      (path) =>
        (path === filename || path.endsWith(`/${filename}`)) && !isVendored(path),
    )
    .map(directoryOf);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJsonObject(
  text: string | undefined,
): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** A manifest-relative path, or undefined when it escapes the package root. */
function relativeEntry(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const cleaned = value.replace(/^\.\//, "");
  if (cleaned.startsWith("/") || cleaned.split("/").includes("..")) return undefined;
  return cleaned;
}

function entryPointsOf(
  manifest: Record<string, unknown>,
  root: string,
): string[] {
  const candidates: unknown[] = [manifest["main"], manifest["module"]];
  const exports = manifest["exports"];
  if (typeof exports === "string") {
    candidates.push(exports);
  } else {
    candidates.push(asRecord(exports)?.["."]);
  }
  const bin = manifest["bin"];
  if (typeof bin === "string") {
    candidates.push(bin);
  } else {
    candidates.push(...Object.values(asRecord(bin) ?? {}));
  }
  const entries = candidates
    .map(relativeEntry)
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => joinPath(root, entry));
  return [...new Set(entries)];
}

function declaredDependenciesOf(manifest: Record<string, unknown>): string[] {
  return [
    ...Object.keys(asRecord(manifest["dependencies"]) ?? {}),
    ...Object.keys(asRecord(manifest["devDependencies"]) ?? {}),
  ];
}

function workspaceGlobs(manifest: Record<string, unknown>): string[] {
  const workspaces = manifest["workspaces"];
  return Array.isArray(workspaces)
    ? stringList(workspaces)
    : stringList(asRecord(workspaces)?.["packages"]);
}

function pnpmGlobs(text: string): string[] {
  try {
    return stringList(asRecord(parseYaml(text))?.["packages"]);
  } catch {
    return [];
  }
}

/** The `module` path of a go.mod, ignoring everything else in it. */
function goModuleName(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = /^\s*module\s+("?)([^"\s]+)\1/.exec(line);
    if (match?.[2] !== undefined) return match[2];
  }
  return undefined;
}

/** `use ./a` and the parenthesised block form. */
function goWorkUses(text: string): string[] {
  const uses: string[] = [];
  let inBlock = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    if (inBlock) {
      if (line.startsWith(")")) inBlock = false;
      else uses.push(line.replace(/"/g, ""));
      continue;
    }
    if (/^use\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    const single = /^use\s+(.+)$/.exec(line);
    if (single?.[1] !== undefined) uses.push(single[1].trim().replace(/"/g, ""));
  }
  return uses.map((use) => use.replace(/^\.\/?/, "").replace(/\/+$/, ""));
}

/** Table name → its lines. Naive on purpose: no TOML dependency. */
function tomlTables(text: string): Map<string, string> {
  const tables = new Map<string, string>();
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    const header = /^\[+([^\]]+)\]+$/.exec(line);
    if (header?.[1] !== undefined) {
      current = header[1].trim().replace(/["']/g, "");
      if (!tables.has(current)) tables.set(current, "");
      continue;
    }
    tables.set(current, `${tables.get(current) ?? ""}${raw}\n`);
  }
  return tables;
}

function tomlString(
  tables: Map<string, string>,
  table: string,
  key: string,
): string | undefined {
  const body = tables.get(table);
  if (body === undefined) return undefined;
  const match = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, "m").exec(body);
  return match?.[1];
}

function tomlArray(
  tables: Map<string, string>,
  table: string,
  key: string,
): string[] {
  const body = tables.get(table);
  if (body === undefined) return [];
  const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "ms").exec(body);
  return [...(match?.[1] ?? "").matchAll(/["']([^"']+)["']/g)].map(
    (found) => found[1] ?? "",
  );
}

function createReader(source: FileSource): (path: string) => Promise<string | undefined> {
  let reads = 0;
  return async (path) => {
    if (reads >= MAX_MANIFEST_READS) return undefined;
    reads += 1;
    return source.read(path);
  };
}

type Reader = (path: string) => Promise<string | undefined>;

async function discoverNode(
  read: Reader,
  paths: readonly string[],
  kinds: Set<ManifestKind>,
): Promise<Found[]> {
  const directories = manifestDirectories(paths, "package.json");
  const known = new Set(paths);
  let globs: string[] = [];
  if (known.has("pnpm-workspace.yaml")) {
    const text = await read("pnpm-workspace.yaml");
    if (text !== undefined) {
      kinds.add("pnpm-workspace");
      globs = pnpmGlobs(text);
    }
  }
  const rootManifest = known.has("package.json")
    ? parseJsonObject(await read("package.json"))
    : undefined;
  if (globs.length === 0 && rootManifest !== undefined) {
    globs = workspaceGlobs(rootManifest);
  }
  const roots =
    globs.length > 0
      ? matchDirectories(globs, directories)
      : rootManifest === undefined
        ? []
        : [""];

  const found: Found[] = [];
  for (const root of roots) {
    const manifest =
      root === "" ? rootManifest : parseJsonObject(await read(joinPath(root, "package.json")));
    if (manifest === undefined) continue;
    kinds.add("package.json");
    const name = manifest["name"];
    found.push({
      record: {
        name: typeof name === "string" && name !== "" ? name : fallbackName(root),
        root,
        entryPoints: entryPointsOf(manifest, root),
        dependsOn: [],
      },
      declaredDependencies: declaredDependenciesOf(manifest),
    });
  }
  return found;
}

async function discoverGo(
  read: Reader,
  paths: readonly string[],
  kinds: Set<ManifestKind>,
): Promise<Found[]> {
  const known = new Set(paths);
  let roots: string[];
  if (known.has("go.work")) {
    const text = await read("go.work");
    kinds.add("go.work");
    roots = text === undefined ? [] : goWorkUses(text);
  } else {
    roots = manifestDirectories(paths, "go.mod");
  }
  const found: Found[] = [];
  for (const root of roots) {
    const text = await read(joinPath(root, "go.mod"));
    if (text === undefined) continue;
    kinds.add("go.mod");
    const module = goModuleName(text);
    found.push({
      record: {
        name: module ?? fallbackName(root),
        root,
        entryPoints: [],
        dependsOn: [],
      },
      declaredDependencies: [],
    });
  }
  return found;
}

async function discoverPython(
  read: Reader,
  paths: readonly string[],
  kinds: Set<ManifestKind>,
): Promise<Found[]> {
  const found: Found[] = [];
  for (const root of manifestDirectories(paths, "pyproject.toml")) {
    const text = await read(joinPath(root, "pyproject.toml"));
    if (text === undefined) continue;
    kinds.add("pyproject");
    const tables = tomlTables(text);
    const name =
      tomlString(tables, "project", "name") ??
      tomlString(tables, "tool.poetry", "name");
    found.push({
      record: {
        name: name ?? fallbackName(root),
        root,
        entryPoints: [],
        dependsOn: [],
      },
      declaredDependencies: [],
    });
  }
  return found;
}

async function discoverCargo(
  read: Reader,
  paths: readonly string[],
  kinds: Set<ManifestKind>,
): Promise<Found[]> {
  const directories = manifestDirectories(paths, "Cargo.toml");
  const rootText = directories.includes("")
    ? await read("Cargo.toml")
    : undefined;
  const members =
    rootText === undefined ? [] : tomlArray(tomlTables(rootText), "workspace", "members");
  const roots =
    members.length > 0
      ? [...new Set([...matchDirectories(members, directories), ""])]
      : directories;

  const found: Found[] = [];
  for (const root of roots) {
    const text = root === "" ? rootText : await read(joinPath(root, "Cargo.toml"));
    if (text === undefined) continue;
    kinds.add("cargo");
    const name = tomlString(tomlTables(text), "package", "name");
    if (name === undefined && root === "" && members.length > 0) continue;
    found.push({
      record: {
        name: name ?? fallbackName(root),
        root,
        entryPoints: [],
        dependsOn: [],
      },
      declaredDependencies: [],
    });
  }
  return found;
}

/** Every package a repository's manifests declare, plus the kinds seen. */
export async function discoverPackages(
  source: FileSource,
  paths: readonly string[],
): Promise<{ packages: PackageRecord[]; manifests: string[] }> {
  const read = createReader(source);
  const kinds = new Set<ManifestKind>();
  const found = [
    ...(await discoverNode(read, paths, kinds)),
    ...(await discoverGo(read, paths, kinds)),
    ...(await discoverPython(read, paths, kinds)),
    ...(await discoverCargo(read, paths, kinds)),
  ];

  const names = new Set(found.map((item) => item.record.name));
  const packages = found
    .map(({ record, declaredDependencies }) => ({
      ...record,
      dependsOn: [...new Set(declaredDependencies)]
        .filter((name) => name !== record.name && names.has(name))
        .sort(),
    }))
    .sort((a, b) => a.root.localeCompare(b.root) || a.name.localeCompare(b.name));

  return { packages, manifests: MANIFEST_ORDER.filter((kind) => kinds.has(kind)) };
}
