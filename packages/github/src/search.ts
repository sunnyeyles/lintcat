/**
 * Repository search semantics, defined once for every adapter: the query
 * grammar, what counts as a match, the snippet windows and the caps.
 */
import type { CodeSearchMatch, CodeSearchResult } from "#src/client";

export const SEARCH_LIMITS = {
  /** Matches one query returns; `totalCount` still reports the repository's true total. */
  maxMatches: 20,
  maxSnippetsPerMatch: 2,
  maxSnippetChars: 400,
  /** Characters kept either side of a term, as GitHub's text-match fragments have. */
  snippetPadding: 120,
} as const;

const SNIPPET_OVERFLOW_MARKER = "…";

/** The last segment of a `/`-separated repository path. */
export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** GitHub's grammar: a quoted phrase is one term, everything else splits on whitespace. */
export function parseSearchQuery(query: string): string[] {
  return (query.match(/"[^"]*"|\S+/g) ?? [])
    .map((term) => term.replaceAll('"', ""))
    .filter((term) => term !== "");
}

/** Back to a `q` string, for a backing store that parses the query itself. */
export function formatSearchQuery(terms: readonly string[]): string {
  return terms.map((term) => (/\s/.test(term) ? `"${term}"` : term)).join(" ");
}

/** Contents only, never the path: every term must appear, ignoring case. */
export function matchesTerms(contents: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const lowered = contents.toLowerCase();
  return terms.every((term) => lowered.includes(term.toLowerCase()));
}

/** Windows around each occurrence, left to right, skipping any the last window covered. */
export function snippetWindows(
  contents: string,
  terms: readonly string[],
): string[] {
  const lowered = contents.toLowerCase();
  const hits: { at: number; length: number }[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    for (let at = lowered.indexOf(needle); at >= 0; at = lowered.indexOf(needle, at + 1)) {
      hits.push({ at, length: needle.length });
    }
  }
  hits.sort((a, b) => a.at - b.at || b.length - a.length);

  const windows: string[] = [];
  let covered = -1;
  for (const hit of hits) {
    if (hit.at < covered) continue;
    const end = hit.at + hit.length + SEARCH_LIMITS.snippetPadding;
    windows.push(contents.slice(Math.max(0, hit.at - SEARCH_LIMITS.snippetPadding), end));
    covered = end;
    if (windows.length >= SEARCH_LIMITS.maxSnippetsPerMatch) break;
  }
  return windows;
}

/** Trimmed, deduplicated and capped: the snippets every adapter returns. */
export function boundSnippets(snippets: readonly string[]): string[] {
  return [...new Set(snippets.map((snippet) => snippet.trim()))]
    .filter((snippet) => snippet !== "")
    .slice(0, SEARCH_LIMITS.maxSnippetsPerMatch)
    .map((snippet) =>
      snippet.length <= SEARCH_LIMITS.maxSnippetChars
        ? snippet
        : snippet.slice(0, SEARCH_LIMITS.maxSnippetChars) + SNIPPET_OVERFLOW_MARKER,
    );
}

/** One match, windowed and bounded; `snippets` may be supplied by the backing store. */
export function buildMatch(
  path: string,
  terms: readonly string[],
  source: { contents: string } | { snippets: readonly string[] },
): CodeSearchMatch {
  const raw =
    "contents" in source ? snippetWindows(source.contents, terms) : source.snippets;
  return {
    path,
    name: basenameOf(path),
    snippets: boundSnippets(raw),
  };
}

function capped(matches: CodeSearchMatch[], totalCount: number): CodeSearchResult {
  return { matches, totalCount, incompleteResults: false };
}

/** The whole corpus as path → contents; this module decides which files match. */
export function searchFiles(
  query: string,
  files: Iterable<readonly [string, string]>,
): CodeSearchResult {
  const terms = parseSearchQuery(query);
  if (terms.length === 0) return capped([], 0);

  const matches: CodeSearchMatch[] = [];
  let totalCount = 0;
  for (const [path, contents] of files) {
    if (!matchesTerms(contents, terms)) continue;
    totalCount += 1;
    if (matches.length < SEARCH_LIMITS.maxMatches) {
      matches.push(buildMatch(path, terms, { contents }));
    }
  }
  return capped(matches, totalCount);
}

/** Paths a store already matched under `matchesTerms`; only capped files are read. */
export function searchMatchedPaths(
  query: string,
  paths: readonly string[],
  read: (path: string) => string,
): CodeSearchResult {
  const terms = parseSearchQuery(query);
  if (terms.length === 0) return capped([], 0);

  const matches = paths
    .slice(0, SEARCH_LIMITS.maxMatches)
    .map((path) => buildMatch(path, terms, { contents: read(path) }));
  return capped(matches, paths.length);
}
