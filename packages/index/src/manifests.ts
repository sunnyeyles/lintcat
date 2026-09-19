/** Reading the manifests that decide what a specifier means. Every parse is
 * best-effort: a malformed file contributes nothing and never throws. */
import { directoryOf, joinPath } from "#src/paths";

/** A `package.json` in the tree, with the fields that resolve a specifier. */
export interface PackageManifest {
  /** The directory holding it, "" at the repository root. */
  readonly root: string;
  readonly name?: string | undefined;
  /** The `exports` field verbatim; walked only when a specifier needs it. */
  readonly exports?: unknown;
  readonly imports?: unknown;
  /** The legacy entry point, used only when there is no `exports` field. */
  readonly main?: string | undefined;
}

/** One `paths` entry of a tsconfig, with its targets made repository-relative. */
export interface PathAlias {
  /** The pattern as the tsconfig spells it, for example `@/*`. */
  readonly pattern: string;
  /** Repository-relative targets, each keeping its `*` where the pattern had one. */
  readonly targets: readonly string[];
}

/** Blanks `//` and `/* *\/` comments, keeping string bodies intact. */
function stripComments(source: string): string {
  let out = "";
  let at = 0;
  while (at < source.length) {
    const char = source[at]!;
    if (char === '"') {
      let end = at + 1;
      while (end < source.length && source[end] !== '"') {
        end += source[end] === "\\" ? 2 : 1;
      }
      out += source.slice(at, Math.min(end + 1, source.length));
      at = end + 1;
      continue;
    }
    if (char === "/" && source[at + 1] === "/") {
      const end = source.indexOf("\n", at);
      at = end < 0 ? source.length : end;
      continue;
    }
    if (char === "/" && source[at + 1] === "*") {
      const end = source.indexOf("*/", at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    out += char;
    at += 1;
  }
  return out;
}

/** JSON with comments and trailing commas, as tsconfig files are written. */
export function parseJsonc(source: string): unknown {
  try {
    return JSON.parse(stripComments(source).replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value.trim());
  return quoted === null ? value.trim() : quoted[2]!;
}

/** A flow sequence, `[a, b]`, as pnpm-workspace.yaml may spell it. */
function flowSequence(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }
  return trimmed
    .slice(1, -1)
    .split(",")
    .map(unquote)
    .filter((entry) => entry !== "");
}

/** The `packages:` list of a pnpm-workspace.yaml, and nothing else of YAML. */
export function parseWorkspaceYamlPackages(source: string): string[] {
  const patterns: string[] = [];
  let inList = false;
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\s#.*$/, "").trimEnd();
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    if (!inList) {
      const header = /^packages:\s*(.*)$/.exec(line);
      if (header === null) {
        continue;
      }
      const inline = flowSequence(header[1]!);
      if (inline !== undefined) {
        return inline;
      }
      inList = true;
      continue;
    }
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (item !== null) {
      patterns.push(unquote(item[1]!));
      continue;
    }
    if (/^\S/.test(line)) {
      break;
    }
  }
  return patterns;
}

/** The `workspaces` field of a root package.json, array or `{ packages }`. */
export function workspacePatternsOf(manifest: unknown): string[] {
  if (!isRecord(manifest)) {
    return [];
  }
  const field = manifest["workspaces"];
  if (isRecord(field)) {
    return stringsOf(field["packages"]);
  }
  return stringsOf(field);
}

/** A package.json read for the fields that resolve specifiers. */
export function readPackageManifest(
  root: string,
  contents: string,
): PackageManifest | undefined {
  const parsed = parseJsonc(contents);
  if (!isRecord(parsed)) {
    return undefined;
  }
  const name = parsed["name"];
  const main = parsed["main"];
  return {
    root,
    ...(typeof name === "string" && name !== "" ? { name } : {}),
    ...(typeof main === "string" && main !== "" ? { main: `./${main}` } : {}),
    ...(parsed["exports"] === undefined ? {} : { exports: parsed["exports"] }),
    ...(parsed["imports"] === undefined ? {} : { imports: parsed["imports"] }),
  };
}

/** Conditions tried in order; the first branch yielding a string wins. */
const CONDITIONS = [
  "import",
  "module",
  "default",
  "require",
  "node",
  "types",
  "browser",
];

/** One branch of an exports or imports value, with `*` filled from the key. */
function selectCondition(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const picked = selectCondition(entry);
      if (picked !== undefined) {
        return picked;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const condition of CONDITIONS) {
    if (condition in value) {
      const picked = selectCondition(value[condition]);
      if (picked !== undefined) {
        return picked;
      }
    }
  }
  return undefined;
}

interface SubpathMatch<Value = unknown> {
  readonly value: Value;
  /** What the key's `*` stood for, absent when the key matched exactly. */
  readonly capture?: string | undefined;
}

/** The exact key, else the `*` key with the longest literal prefix. */
export function matchSubpathKey<Value>(
  map: Record<string, Value>,
  subject: string,
): SubpathMatch<Value> | undefined {
  if (subject in map) {
    return { value: map[subject]! };
  }
  let best: { value: Value; capture: string; head: number } | undefined;
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star < 0) {
      continue;
    }
    const head = key.slice(0, star);
    const tail = key.slice(star + 1);
    if (
      !subject.startsWith(head) ||
      !subject.endsWith(tail) ||
      subject.length < head.length + tail.length
    ) {
      continue;
    }
    if (best === undefined || head.length > best.head) {
      const capture = subject.slice(head.length, subject.length - tail.length);
      best = { value, capture, head: head.length };
    }
  }
  return best === undefined
    ? undefined
    : { value: best.value, capture: best.capture };
}

function targetsOf(match: SubpathMatch | undefined): string[] {
  const picked = match === undefined ? undefined : selectCondition(match.value);
  if (picked === undefined) {
    return [];
  }
  return [
    match?.capture === undefined ? picked : picked.replaceAll("*", match.capture),
  ];
}

/** The package-relative target a subpath reaches through an `exports` field. */
export function resolveExportsField(field: unknown, subpath: string): string[] {
  if (typeof field === "string") {
    return subpath === "." ? [field] : [];
  }
  if (Array.isArray(field)) {
    return field.flatMap((entry) => resolveExportsField(entry, subpath));
  }
  if (!isRecord(field)) {
    return [];
  }
  if (!Object.keys(field).some((key) => key.startsWith("."))) {
    return subpath === "." ? targetsOf({ value: field }) : [];
  }
  return targetsOf(matchSubpathKey(field, subpath));
}

/** The package-relative target a `#specifier` reaches through an `imports` map. */
export function resolveImportsField(
  field: unknown,
  specifier: string,
): string[] {
  return isRecord(field) ? targetsOf(matchSubpathKey(field, specifier)) : [];
}

interface CompilerOptions {
  baseUrl?: { directory: string; value: string };
  paths?: { directory: string; value: Record<string, unknown> };
}

/** Where `extends` points, or undefined when only node_modules could say. */
function extendsTarget(
  from: string,
  target: string,
  packageRoots: ReadonlyMap<string, string>,
): string | undefined {
  if (target.startsWith(".")) {
    const joined = joinPath(directoryOf(from), target);
    if (joined === undefined) {
      return undefined;
    }
    return joined.endsWith(".json") ? joined : `${joined}.json`;
  }
  // A bare `extends` names a package; only a workspace one is in the archive.
  for (const [name, root] of packageRoots) {
    if (target === name) {
      return joinPath(root, "tsconfig.json");
    }
    if (target.startsWith(`${name}/`)) {
      const rest = target.slice(name.length + 1);
      return joinPath(root, rest.endsWith(".json") ? rest : `${rest}.json`);
    }
  }
  return undefined;
}

/** Merges a config over what it extends; the nearer file wins each field. */
function collectOptions(
  path: string,
  files: ReadonlyMap<string, string>,
  packageRoots: ReadonlyMap<string, string>,
  seen: Set<string>,
): CompilerOptions {
  if (seen.has(path)) {
    return {};
  }
  seen.add(path);
  const contents = files.get(path);
  const parsed = contents === undefined ? undefined : parseJsonc(contents);
  if (!isRecord(parsed)) {
    return {};
  }

  let options: CompilerOptions = {};
  for (const target of stringsOf(parsed["extends"])) {
    const next = extendsTarget(path, target, packageRoots);
    if (next !== undefined) {
      options = {
        ...options,
        ...collectOptions(next, files, packageRoots, seen),
      };
    }
  }

  const compiler = parsed["compilerOptions"];
  if (!isRecord(compiler)) {
    return options;
  }
  const directory = directoryOf(path);
  if (typeof compiler["baseUrl"] === "string") {
    options.baseUrl = { directory, value: compiler["baseUrl"] };
  }
  if (isRecord(compiler["paths"])) {
    options.paths = { directory, value: compiler["paths"] };
  }
  return options;
}

/** The `paths` of one tsconfig, `extends` followed and targets rebased onto
 * `baseUrl`, or onto the directory of the config that declared them. */
export function readPathAliases(
  path: string,
  files: ReadonlyMap<string, string>,
  packageRoots: ReadonlyMap<string, string>,
): PathAlias[] {
  const options = collectOptions(path, files, packageRoots, new Set());
  const paths = options.paths;
  if (paths === undefined) {
    return [];
  }
  const base =
    options.baseUrl === undefined
      ? paths.directory
      : joinPath(options.baseUrl.directory, options.baseUrl.value);
  if (base === undefined) {
    return [];
  }

  const aliases: PathAlias[] = [];
  for (const [pattern, value] of Object.entries(paths.value)) {
    const targets = stringsOf(value)
      .map((target) => rebase(base, target))
      .filter((target): target is string => target !== undefined);
    if (targets.length > 0) {
      aliases.push({ pattern, targets });
    }
  }
  return aliases;
}

/** Joins a target onto its base while keeping the `*` the pattern captures. */
function rebase(base: string, target: string): string | undefined {
  const star = target.indexOf("*");
  if (star < 0) {
    return joinPath(base, target);
  }
  const head = joinPath(base, target.slice(0, star));
  if (head === undefined) {
    return undefined;
  }
  const prefix = target.slice(0, star).endsWith("/") ? `${head}/` : head;
  return `${prefix}*${target.slice(star + 1)}`;
}
