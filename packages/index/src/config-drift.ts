/** Config and dependency drift found in code: undocumented env vars and duplicate-purpose dependencies. */
import type { RepositoryIndex } from "#src/build";
import { purposeOf } from "#src/dependency-purposes";
import { isDocPath, mentionedTerms } from "#src/docs";
import { basenameOf } from "#src/paths";
import { patchLines, type PatchedFile } from "#src/patch-lines";
import { classifyFileRole } from "#src/roles";

/** A variable an env example file declares. */
export interface EnvExampleEntry {
  readonly file: string;
  readonly line: number;
  readonly name: string;
}

/** One entry of a package.json dependency section. */
export interface DeclaredDependency {
  readonly manifest: string;
  readonly line: number;
  readonly name: string;
}

export interface SourceLine {
  readonly file: string;
  readonly line: number;
}

/** An env var the change starts reading that no env example or doc names. */
export interface UndocumentedEnvVar {
  readonly name: string;
  /** Where the change reads it, on an added line. */
  readonly at: SourceLine;
  /** Where the repository documents its other env vars. */
  readonly documented: readonly SourceLine[];
}

/** A dependency the change adds for a job one the repository already uses does. */
export interface DuplicateDependency {
  readonly name: string;
  readonly purpose: string;
  /** The added manifest line. */
  readonly at: SourceLine;
  readonly existing: string;
  /** Where the repository already uses the existing one. */
  readonly uses: readonly SourceLine[];
}

export interface ConfigDrift {
  readonly env: readonly UndocumentedEnvVar[];
  readonly dependencies: readonly DuplicateDependency[];
}

/** Lines a fact must be able to cite: a convention seen once is not a convention. */
const MIN_CITED = 2;
const MAX_CITED = 3;

const ENV_EXAMPLE_NAME =
  /^(?:\.env(?:\.[\w-]+)*\.(?:example|sample|template|dist|defaults)|(?:example|sample)\.env|env\.example)$/i;

export function isEnvExamplePath(path: string): boolean {
  return ENV_EXAMPLE_NAME.test(basenameOf(path));
}

const ENV_ASSIGNMENT = /^\s*(?:#\s*)?(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/;

export function readEnvExample(file: string, contents: string): EnvExampleEntry[] {
  return contents.split("\n").flatMap((text, at) => {
    const name = ENV_ASSIGNMENT.exec(text)?.[1];
    return name === undefined ? [] : [{ file, line: at + 1, name }];
  });
}

const DEPENDENCY_SECTION = /^\s*"(?:dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{\s*$/;
const DEPENDENCY_ENTRY = /^\s*"((?:@[\w.-]+\/)?[\w.-]+)"\s*:\s*"([^"]*)"/;
const VERSION_LIKE = /^(?:[\^~<>=v]*\s*\d|\*|x$|latest|next|workspace:|npm:|github:|git|file:|link:|https?:)/;

/** A package.json's dependency entries, found by line so each can be cited. */
export function readDependencies(manifest: string, contents: string): DeclaredDependency[] {
  const found: DeclaredDependency[] = [];
  let inSection = false;
  contents.split("\n").forEach((text, at) => {
    if (DEPENDENCY_SECTION.test(text)) {
      inSection = true;
    } else if (inSection && /^\s*\}/.test(text)) {
      inSection = false;
    } else if (inSection) {
      const name = DEPENDENCY_ENTRY.exec(text)?.[1];
      if (name !== undefined) found.push({ manifest, line: at + 1, name });
    }
  });
  return found;
}

const ENV_READ = new RegExp(
  [
    String.raw`(?:process\.env|import\.meta\.env|(?<![\w$.])env)\.([A-Z][A-Z0-9_]+)\b`,
    String.raw`(?:process\.env|import\.meta\.env|(?<![\w$.])env|\bENV|\benviron)\[\s*["'\x60]([A-Z][A-Z0-9_]+)["'\x60]\s*\]`,
    String.raw`(?:\bgetenv|\bGetenv|\bLookupEnv|\benv\.get|\benviron\.get|\bENV\.fetch)\(\s*["'\x60]([A-Z][A-Z0-9_]+)["'\x60]`,
  ].join("|"),
  "g",
);

/** Set by the platform, not by the repository's own configuration. */
const PLATFORM_ENV = new Set([
  "CI", "DEBUG", "HOME", "HOSTNAME", "LANG", "NODE_ENV", "PATH", "PWD", "SHELL", "TERM", "TMPDIR", "TZ", "USER",
]);

export function envReadsOn(text: string): string[] {
  return [...text.matchAll(ENV_READ)]
    .map((match) => match[1] ?? match[2] ?? match[3]!)
    .filter((name) => !PLATFORM_ENV.has(name));
}

function readsEnv(path: string): boolean {
  const role = classifyFileRole(path);
  return role === "source" || role === "config";
}

function sortedLines(lines: Iterable<SourceLine>): SourceLine[] {
  const unique = new Map([...lines].map((entry) => [`${entry.file}:${entry.line}`, entry]));
  return [...unique.values()].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line,
  );
}

function undocumentedEnv(
  index: RepositoryIndex,
  files: readonly PatchedFile[],
  changedPaths: ReadonlySet<string>,
): UndocumentedEnvVar[] {
  const documented = new Set<string>(index.envExamples.map((entry) => entry.name));
  for (const doc of index.docs.values()) {
    doc.mentions.forEach((mention) => documented.add(mention.term));
  }
  const reads = new Map<string, SourceLine>();
  const dropped = new Set<string>();
  for (const file of files) {
    const lines = patchLines(file.patch);
    if (isEnvExamplePath(file.filename) || isDocPath(file.filename)) {
      for (const { text } of lines.added) {
        readEnvExample(file.filename, text).forEach((entry) => documented.add(entry.name));
        [...mentionedTerms(text), ...mentionedTerms(text, true)].forEach((term) => documented.add(term));
      }
      continue;
    }
    if (!readsEnv(file.filename)) {
      continue;
    }
    lines.removed.forEach(({ text }) => envReadsOn(text).forEach((name) => dropped.add(name)));
    for (const { line, text } of lines.added) {
      for (const name of envReadsOn(text)) {
        if (!reads.has(name)) reads.set(name, { file: file.filename, line });
      }
    }
  }

  const cited = sortedLines([
    ...index.envExamples
      .filter((entry) => !changedPaths.has(entry.file))
      .map((entry) => ({ file: entry.file, line: entry.line })),
    ...[...index.docs.values()]
      .filter((doc) => !changedPaths.has(doc.path))
      .flatMap((doc) => doc.mentions.filter((mention) => mention.kind === "env").map((mention) => ({ file: doc.path, line: mention.line }))),
  ]).slice(0, MAX_CITED);
  if (cited.length < MIN_CITED) {
    return [];
  }
  return [...reads]
    .filter(([name]) => !documented.has(name) && !dropped.has(name))
    .map(([name, at]) => ({ name, at, documented: cited }));
}

function importSites(index: RepositoryIndex, name: string, changedPaths: ReadonlySet<string>): SourceLine[] {
  return index.edges
    .filter(
      (edge) =>
        (edge.specifier === name || edge.specifier.startsWith(`${name}/`)) && !changedPaths.has(edge.from),
    )
    .map((edge) => ({ file: edge.from, line: edge.line }));
}

function duplicateDependencies(
  index: RepositoryIndex,
  files: readonly PatchedFile[],
  changedPaths: ReadonlySet<string>,
): DuplicateDependency[] {
  const declared = new Set(index.dependencies.map((entry) => entry.name));
  const manifests = files.filter((file) => basenameOf(file.filename) === "package.json" && file.status !== "removed");
  const namesOn = (side: "added" | "removed") =>
    new Set(
      manifests.flatMap((file) =>
        patchLines(file.patch)[side].flatMap(({ text }) => DEPENDENCY_ENTRY.exec(text)?.[1] ?? []),
      ),
    );
  const readded = namesOn("added");
  const removed = new Set([...namesOn("removed")].filter((name) => !readded.has(name)));

  const found: DuplicateDependency[] = [];
  for (const file of manifests) {
    for (const { line, text } of patchLines(file.patch).added) {
      const entry = DEPENDENCY_ENTRY.exec(text);
      const name = entry?.[1];
      const purpose = name === undefined ? undefined : purposeOf(name);
      if (name === undefined || purpose === undefined || !VERSION_LIKE.test(entry![2]!) || declared.has(name) || removed.has(name)) {
        continue;
      }
      const ranked = purpose.alternatives
        .filter((other) => !removed.has(other))
        .map((other) => ({
          other,
          uses: sortedLines([
            ...importSites(index, other, changedPaths),
            ...index.dependencies
              .filter((dependency) => dependency.name === other && !changedPaths.has(dependency.manifest))
              .map((dependency) => ({ file: dependency.manifest, line: dependency.line })),
          ]),
        }))
        .sort((a, b) => b.uses.length - a.uses.length);
      const best = ranked[0];
      if (best !== undefined && best.uses.length >= MIN_CITED) {
        found.push({
          name,
          purpose: purpose.purpose,
          at: { file: file.filename, line },
          existing: best.other,
          uses: best.uses.slice(0, MAX_CITED),
        });
      }
    }
  }
  return found;
}

/** What the diff adds against how the base commit documents env vars and picks dependencies. */
export function findConfigDrift(
  index: RepositoryIndex,
  files: readonly PatchedFile[],
  changedPaths: ReadonlySet<string>,
): ConfigDrift {
  return {
    env: undocumentedEnv(index, files, changedPaths),
    dependencies: duplicateDependencies(index, files, changedPaths),
  };
}
