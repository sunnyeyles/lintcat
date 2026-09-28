/** Doc lines that mention a name, key, env var or flag a pull request's code edits or removes. */
import type { RepositoryIndex } from "#src/build";
import { isDocPath } from "#src/docs";
import { patchLines, type PatchedFile } from "#src/patch-lines";

export interface DocLineMention {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  /** The changed names this line mentions. */
  readonly terms: readonly string[];
  /** True when one of them is on a removed line and on no added one. */
  readonly removed: boolean;
}

const CODE_TOKEN = /(?<![\w-])--[A-Za-z][\w-]*|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;

const TOO_COMMON = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "default",
  "delete", "else", "enum", "export", "extends", "false", "finally", "from", "function",
  "import", "interface", "let", "new", "null", "return", "self", "static", "string",
  "number", "boolean", "super", "switch", "this", "throw", "true", "try", "type",
  "typeof", "undefined", "void", "while", "with", "yield", "def", "elif", "None",
  "True", "False", "pass", "func", "package", "var", "public", "private",
]);

/** Names written on a line of code, dotted ones also split into their parts. */
export function namesOnLine(text: string): string[] {
  const names = new Set<string>();
  for (const token of text.match(CODE_TOKEN) ?? []) {
    for (const name of [token, ...(token.includes(".") ? token.split(".") : [])]) {
      if (name.length >= 3 && !TOO_COMMON.has(name)) {
        names.add(name);
      }
    }
  }
  return [...names];
}

export interface ChangedNames {
  /** Every name on a removed line of a changed non-doc file; a pure addition makes no doc false. */
  readonly all: ReadonlySet<string>;
  /** Names on removed lines that no added line writes again. */
  readonly removed: ReadonlySet<string>;
}

export function changedNames(files: readonly PatchedFile[]): ChangedNames {
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const file of files) {
    if (isDocPath(file.filename)) {
      continue;
    }
    const lines = patchLines(file.patch);
    for (const { text } of lines.added) namesOnLine(text).forEach((name) => added.add(name));
    for (const { text } of lines.removed) namesOnLine(text).forEach((name) => removed.add(name));
  }
  return {
    all: removed,
    removed: new Set([...removed].filter((name) => !added.has(name))),
  };
}

/** Lines of docs the pull request leaves alone, lines naming a removed name first. */
export function docLinesMentioning(
  index: RepositoryIndex,
  names: ChangedNames,
  changedPaths: ReadonlySet<string>,
): DocLineMention[] {
  const found: DocLineMention[] = [];
  for (const doc of index.docs.values()) {
    if (changedPaths.has(doc.path)) {
      continue;
    }
    const byLine = new Map<number, { text: string; terms: Set<string> }>();
    for (const mention of doc.mentions) {
      if (!names.all.has(mention.term)) {
        continue;
      }
      const entry = byLine.get(mention.line) ?? { text: mention.text, terms: new Set<string>() };
      entry.terms.add(mention.term);
      byLine.set(mention.line, entry);
    }
    for (const [line, { text, terms }] of byLine) {
      found.push({
        file: doc.path,
        line,
        text,
        terms: [...terms],
        removed: [...terms].some((term) => names.removed.has(term)),
      });
    }
  }
  return found.sort(
    (a, b) =>
      Number(b.removed) - Number(a.removed) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
  );
}
