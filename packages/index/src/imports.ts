/**
 * The import statements of one TypeScript or JavaScript file, read without a
 * compiler: comments and string bodies are masked first, then matched.
 */

/** How a file binds what it imports. */
export type ImportKind = "named" | "default" | "namespace";

export interface ImportedName {
  readonly kind: ImportKind;
  /** The name the target exports: "default" or "*" for the other kinds. */
  readonly name: string;
}

export interface ParsedImport {
  readonly specifier: string;
  /** 1-based line of the statement that carries the specifier. */
  readonly line: number;
  /** Empty for a side-effect import, which binds nothing. */
  readonly names: readonly ImportedName[];
}

/** Stands in for every character of a masked string body. */
const FILLER = "\u0001";

/** A word here cannot be followed by a regular expression literal. */
const OPERAND_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

const WORD_CHARACTER = /[\w$]/;

interface MaskedSource {
  text: string;
  /** Each literal's body, by the index of its opening quote. */
  values: Map<number, string>;
}

function isDivision(token: string): boolean {
  if (token === "") {
    return false;
  }
  if (WORD_CHARACTER.test(token[0] ?? "")) {
    return !OPERAND_KEYWORDS.has(token);
  }
  return token === ")" || token === "]" || token === "}" || token === "++";
}

/** Index just past the literal opened at `start`; undefined when unterminated.
 * Only a template literal may span lines, so a lone `'` is JSX text, not a quote. */
function endOfLiteral(source: string, start: number): number | undefined {
  const quote = source[start];
  const multiline = quote === "`";
  let at = start + 1;
  while (at < source.length) {
    const char = source[at];
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === quote) {
      return at + 1;
    }
    if (char === "\n" && !multiline) {
      return undefined;
    }
    at += 1;
  }
  return multiline ? source.length : undefined;
}

/** Index just past the regular expression opened at `start`. */
function endOfRegex(source: string, start: number): number {
  let at = start + 1;
  let inClass = false;
  while (at < source.length) {
    const char = source[at];
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === "\n") {
      return at;
    }
    if (char === "[") {
      inClass = true;
    } else if (char === "]") {
      inClass = false;
    } else if (char === "/" && !inClass) {
      return at + 1;
    }
    at += 1;
  }
  return source.length;
}

/** Blanks comments and literal bodies, keeping every offset and line intact. */
function maskSource(source: string): MaskedSource {
  const out: string[] = [];
  const values = new Map<number, string>();
  let token = "";
  let at = 0;

  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      out.push(source[index] === "\n" ? "\n" : " ");
    }
  };

  while (at < source.length) {
    const char = source[at]!;
    const next = source[at + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", at);
      const stop = end < 0 ? source.length : end;
      blank(at, stop);
      at = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", at + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(at, stop);
      at = stop;
      continue;
    }
    if (char === "/" && !isDivision(token)) {
      const stop = endOfRegex(source, at);
      blank(at, stop);
      at = stop;
      token = "/";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const stop = endOfLiteral(source, at);
      if (stop === undefined) {
        out.push(char);
        token = char;
        at += 1;
        continue;
      }
      const body = source.slice(at + 1, stop - 1);
      values.set(at, body);
      out.push(char, FILLER.repeat(body.length));
      out.push(source[stop - 1] === char ? char : " ");
      at = stop;
      token = char;
      continue;
    }
    if (WORD_CHARACTER.test(char)) {
      let end = at;
      while (end < source.length && WORD_CHARACTER.test(source[end]!)) {
        end += 1;
      }
      token = source.slice(at, end);
      out.push(token);
      at = end;
      continue;
    }
    out.push(char);
    if (!/\s/.test(char)) {
      token = char;
    }
    at += 1;
  }

  return { text: out.join(""), values };
}

const LITERAL = `(?<quote>['"\`])(?<fill>${FILLER}*)\\k<quote>`;

const IDENTIFIER_PATTERN = "[A-Za-z_$][\\w$]*";

/** An import clause, spelled out so it can never run past its statement. */
const CLAUSE = [
  `(?:type\\s+)?`,
  `(?:(?:${IDENTIFIER_PATTERN}\\s*,\\s*)?`,
  `(?:\\*(?:\\s+as\\s+${IDENTIFIER_PATTERN})?|\\{[^{}]*\\})`,
  `|${IDENTIFIER_PATTERN})`,
].join("");

/** `import … from "x"` and `export … from "x"`. */
const FROM_STATEMENT = new RegExp(
  `(?<![\\w$.])(?:import|export)\\s+(?<clause>${CLAUSE})\\s*\\bfrom\\s*${LITERAL}`,
  "g",
);

/** `import "x"`, which binds nothing. */
const SIDE_EFFECT = new RegExp(`(?<![\\w$.])import\\s*${LITERAL}`, "g");

/** `import("x")` and `require("x")`, which reach the whole module. */
const CALL_FORM = new RegExp(
  `(?<![\\w$.])(?:import|require)\\s*\\(\\s*${LITERAL}`,
  "g",
);

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let at = source.indexOf("\n"); at >= 0; at = source.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

function lineOf(starts: readonly number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= index) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}

const IDENTIFIER = /^([A-Za-z_$][\w$]*)/;

function namedEntry(entry: string): ImportedName | undefined {
  const name = IDENTIFIER.exec(entry.trim().replace(/^type\s+/, ""))?.[1];
  if (name === undefined) {
    return undefined;
  }
  return { kind: name === "default" ? "default" : "named", name };
}

/** The bindings of one import clause: the text between `import` and `from`. */
function parseClause(clause: string): ImportedName[] {
  const names: ImportedName[] = [];
  let rest = clause.trim().replace(/^type\s+/, "");

  const leading = IDENTIFIER.exec(rest);
  if (leading !== null) {
    names.push({ kind: "default", name: "default" });
    rest = rest.slice(leading[0].length).replace(/^\s*,\s*/, "").trim();
  }
  if (rest.startsWith("*")) {
    names.push({ kind: "namespace", name: "*" });
    return names;
  }
  const braced = /\{([^}]*)\}/.exec(rest);
  if (braced === null) {
    return names;
  }
  for (const entry of braced[1]!.split(",")) {
    const named = namedEntry(entry);
    if (named !== undefined) {
      names.push(named);
    }
  }
  return names;
}

/** Every import of `source`, in source order, deduplicated by specifier position. */
export function parseImports(source: string): ParsedImport[] {
  const { text, values } = maskSource(source);
  const starts = lineStarts(source);
  const found = new Map<number, ParsedImport>();

  const record = (match: RegExpExecArray, names: ImportedName[]): void => {
    const quoteAt =
      match.index + match[0].length - (match.groups?.["fill"]?.length ?? 0) - 2;
    const specifier = values.get(quoteAt);
    // An interpolated template is not a specifier, and must never be guessed at.
    if (
      specifier === undefined ||
      specifier === "" ||
      specifier.includes("${") ||
      found.has(quoteAt)
    ) {
      return;
    }
    found.set(quoteAt, {
      specifier,
      line: lineOf(starts, match.index),
      names,
    });
  };

  for (const match of text.matchAll(FROM_STATEMENT)) {
    record(match, parseClause(match.groups?.["clause"] ?? ""));
  }
  for (const match of text.matchAll(SIDE_EFFECT)) {
    record(match, []);
  }
  for (const match of text.matchAll(CALL_FORM)) {
    record(match, [{ kind: "namespace", name: "*" }]);
  }

  return [...found.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, parsed]) => parsed);
}
