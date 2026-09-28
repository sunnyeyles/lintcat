/** Markdown docs: their headings, the links they make, and the names they mention. */
import { directoryOf, extensionOf, joinPath } from "#src/paths";

const DOC_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

export function isDocPath(path: string): boolean {
  return DOC_EXTENSIONS.has(extensionOf(path).toLowerCase());
}

/** What a mentioned term looks like: `NOTIFY_URL`, `--dry-run`, `review.maxFindings`, `loadConfig`. */
export type MentionKind = "env" | "flag" | "key" | "identifier";

export interface DocMention {
  readonly term: string;
  readonly kind: MentionKind;
  readonly line: number;
  /** The whole line, trimmed and capped, so a prompt can quote it. */
  readonly text: string;
}

export interface DocHeading {
  readonly text: string;
  /** The fragment GitHub gives it, duplicates suffixed `-1`, `-2`. */
  readonly anchor: string;
  readonly line: number;
}

export interface DocLink {
  /** The destination exactly as written. */
  readonly target: string;
  readonly line: number;
}

export interface IndexedDoc {
  readonly path: string;
  readonly headings: readonly DocHeading[];
  /** Every fragment a link can land on: heading anchors and explicit HTML ids. */
  readonly anchors: readonly string[];
  readonly links: readonly DocLink[];
  readonly mentions: readonly DocMention[];
}

const MAX_QUOTED_CHARS = 200;

const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const ENV_IN_TEXT = /(?<![\w$])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![\w$])/g;
const FLAG_IN_TEXT = /(?<![\w-])--?[a-zA-Z][\w-]*/g;
const TERM = /^(?:--?[a-zA-Z][\w-]*|[A-Za-z_$][\w$]*(?:[.:][A-Za-z_$][\w$-]*)*)$/;

function kindOf(term: string): MentionKind {
  if (term.startsWith("-")) return "flag";
  if (ENV_NAME.test(term)) return "env";
  return /[.:]/.test(term) ? "key" : "identifier";
}

/** The terms one code span names: itself when it is one term, else its env vars and flags. */
function termsOfCode(code: string): string[] {
  const trimmed = code.trim().replace(/\(\)$/, "").replace(/=.*$/, "");
  const envs = code.match(ENV_IN_TEXT) ?? [];
  if (TERM.test(trimmed)) {
    return [trimmed, ...envs];
  }
  return [...envs, ...(code.match(FLAG_IN_TEXT) ?? [])];
}

/** Terms a line of prose mentions; `codeOnly` for a line inside a fence. */
export function mentionedTerms(text: string, codeOnly = false): string[] {
  if (codeOnly) {
    return [...new Set(termsOfCode(text))];
  }
  const terms: string[] = [];
  const prose = text.replace(/`+([^`]+)`+/g, (_span, code: string) => {
    terms.push(...termsOfCode(code));
    return " ";
  });
  terms.push(...(prose.match(ENV_IN_TEXT) ?? []));
  terms.push(...(prose.match(/(?<![\w-])--[a-zA-Z][\w-]*/g) ?? []));
  return [...new Set(terms)];
}

/** Inline formatting removed, so a heading's slug is taken from its words. */
function plainHeading(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*~]/g, "")
    .trim();
}

/** GitHub's heading slug, before duplicate suffixes. */
export function headingSlug(text: string): string {
  return plainHeading(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const INLINE_LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const HTML_HREF = /\bhref\s*=\s*["']([^"']+)["']/gi;
const HTML_ID = /\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;

/** Link destinations on one line, code spans excluded. */
function linksOn(text: string): string[] {
  const prose = text.replace(/`+[^`]+`+/g, " ");
  const definition = REFERENCE_DEFINITION.exec(prose);
  return [
    ...(definition === null ? [] : [definition[1]!]),
    ...[...prose.matchAll(INLINE_LINK)].map((match) => match[1]!),
    ...[...prose.matchAll(HTML_HREF)].map((match) => match[1]!),
  ];
}

const ATX_HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function quoted(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_QUOTED_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_QUOTED_CHARS)}…`;
}

/** Reads one Markdown file. Never throws; anything unrecognised is ordinary text. */
export function readDoc(path: string, contents: string): IndexedDoc {
  const headings: DocHeading[] = [];
  const explicit: string[] = [];
  const links: DocLink[] = [];
  const mentions: DocMention[] = [];
  const slugCounts = new Map<string, number>();
  const addHeading = (text: string, line: number): void => {
    const slug = headingSlug(text);
    const seen = slugCounts.get(slug) ?? 0;
    slugCounts.set(slug, seen + 1);
    headings.push({ text: plainHeading(text), anchor: seen === 0 ? slug : `${slug}-${seen}`, line });
  };

  const lines = contents.split("\n");
  let fence: string | undefined;
  let paragraph: { text: string; line: number } | undefined;
  lines.forEach((raw, at) => {
    const line = at + 1;
    const opener = FENCE.exec(raw);
    if (fence !== undefined) {
      if (opener !== null && opener[1]!.startsWith(fence)) {
        fence = undefined;
      } else {
        for (const term of mentionedTerms(raw, true)) {
          mentions.push({ term, kind: kindOf(term), line, text: quoted(raw) });
        }
      }
      return;
    }
    if (opener !== null) {
      fence = opener[1]!;
      paragraph = undefined;
      return;
    }
    const atx = ATX_HEADING.exec(raw);
    if (atx !== null) {
      addHeading(atx[1]!, line);
    } else if (paragraph !== undefined && SETEXT_UNDERLINE.test(raw)) {
      addHeading(paragraph.text, paragraph.line);
    }
    paragraph = raw.trim() === "" || atx !== null ? undefined : { text: raw, line };
    for (const match of raw.matchAll(HTML_ID)) {
      explicit.push(match[1]!);
    }
    for (const target of linksOn(raw)) {
      links.push({ target, line });
    }
    for (const term of mentionedTerms(raw)) {
      mentions.push({ term, kind: kindOf(term), line, text: quoted(raw) });
    }
  });

  return {
    path,
    headings,
    anchors: [...new Set([...headings.map((heading) => heading.anchor), ...explicit])],
    links,
    mentions,
  };
}

/** Where a link lands in the repository; an empty `fragment` means no anchor. */
export interface LinkDestination {
  /** Repository-relative, without a trailing slash; "" is the root. */
  readonly path: string;
  readonly fragment: string;
}

/** A relative link resolved from `from`; undefined for a URL, or a path above the root. */
export function resolveDocLink(from: string, target: string): LinkDestination | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
    return undefined;
  }
  const hash = target.indexOf("#");
  const beforeHash = hash < 0 ? target : target.slice(0, hash);
  const rawPath = beforeHash.replace(/\?.*$/, "");
  let fragment = hash < 0 ? "" : target.slice(hash + 1);
  let decodedPath = rawPath;
  try {
    decodedPath = decodeURI(rawPath);
    fragment = decodeURIComponent(fragment);
  } catch {
    return undefined;
  }
  if (decodedPath === "") {
    return { path: from, fragment };
  }
  const path = decodedPath.startsWith("/")
    ? joinPath("", decodedPath)
    : joinPath(directoryOf(from), decodedPath);
  return path === undefined ? undefined : { path, fragment };
}
