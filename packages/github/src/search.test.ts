/** The one search semantics every adapter runs on. */
import { describe, expect, it } from "vitest";

import {
  SEARCH_LIMITS,
  boundSnippets,
  formatSearchQuery,
  matchesTerms,
  parseSearchQuery,
  searchFiles,
  searchMatchedPaths,
  snippetWindows,
} from "#src/search";

describe("parseSearchQuery", () => {
  it.each([
    ["createSession", ["createSession"]],
    ["  export   const  ", ["export", "const"]],
    ['"export const page"', ["export const page"]],
    ['createSession "one two"', ["createSession", "one two"]],
    ['""', []],
    ["", []],
  ])("parses %s", (query, terms) => {
    expect(parseSearchQuery(query)).toEqual(terms);
  });

  it("keeps the case the caller typed, so a backing store sees the original query", () => {
    expect(parseSearchQuery("CreateSession")).toEqual(["CreateSession"]);
  });

  it("round-trips through formatSearchQuery, requoting a phrase", () => {
    expect(formatSearchQuery(parseSearchQuery('a "b c" d'))).toBe('a "b c" d');
  });
});

describe("matchesTerms", () => {
  it("requires every term, ignoring case", () => {
    expect(matchesTerms("export const page = 1;", ["EXPORT", "page"])).toBe(true);
    expect(matchesTerms("export const page = 1;", ["export", "missing"])).toBe(false);
  });

  it("matches nothing when the query parsed to no terms", () => {
    expect(matchesTerms("anything", [])).toBe(false);
  });
});

describe("snippetWindows", () => {
  const padding = SEARCH_LIMITS.snippetPadding;

  it("takes a padded window around a hit", () => {
    const contents = `${"x".repeat(300)}needle${"y".repeat(300)}`;

    expect(snippetWindows(contents, ["needle"])).toEqual([
      `${"x".repeat(padding)}needle${"y".repeat(padding)}`,
    ]);
  });

  it("skips a hit the previous window already covers", () => {
    expect(snippetWindows("needle needle", ["needle"])).toHaveLength(1);
  });

  it("opens a new window once a hit falls outside the last one", () => {
    const contents = `needle${"-".repeat(300)}needle`;

    expect(snippetWindows(contents, ["needle"])).toHaveLength(2);
  });

  it("never returns more windows than the snippet cap allows", () => {
    const contents = Array.from({ length: 10 }, () => `needle${"-".repeat(300)}`).join("");

    expect(snippetWindows(contents, ["needle"])).toHaveLength(
      SEARCH_LIMITS.maxSnippetsPerMatch,
    );
  });
});

describe("boundSnippets", () => {
  it("trims, drops the empty, deduplicates and caps", () => {
    expect(boundSnippets(["same\n", "  same", "", "different", "third"])).toEqual([
      "same",
      "different",
    ]);
  });

  it("marks a snippet it had to shorten", () => {
    const [snippet] = boundSnippets(["z".repeat(SEARCH_LIMITS.maxSnippetChars + 50)]);

    expect(snippet).toHaveLength(SEARCH_LIMITS.maxSnippetChars + 1);
    expect(snippet?.endsWith("…")).toBe(true);
  });
});

describe("searchFiles", () => {
  const flood = Array.from({ length: 30 }, (_unused, index) => [
    `src/file-${String(index).padStart(2, "0")}.ts`,
    "needle\n",
  ]) as [string, string][];

  it("caps the matches while reporting the repository's true total", () => {
    const result = searchFiles("needle", flood);

    expect(result.matches).toHaveLength(SEARCH_LIMITS.maxMatches);
    expect(result.totalCount).toBe(30);
    expect(result.incompleteResults).toBe(false);
  });

  it("never matches on the path", () => {
    const result = searchFiles("file-00", flood);

    expect(result).toEqual({ matches: [], totalCount: 0, incompleteResults: false });
  });

  it("names a match by its base name", () => {
    const [match] = searchFiles("needle", [["src/deep/a.ts", "needle"]]).matches;

    expect(match).toMatchObject({ path: "src/deep/a.ts", name: "a.ts" });
  });

  it("answers an empty query with nothing rather than everything", () => {
    expect(searchFiles('  "" ', flood).totalCount).toBe(0);
  });
});

describe("searchMatchedPaths", () => {
  it("reads only the files inside the match cap", () => {
    const paths = Array.from({ length: 30 }, (_unused, index) => `src/${index}.ts`);
    const read: string[] = [];

    const result = searchMatchedPaths("needle", paths, (path) => {
      read.push(path);
      return "needle\n";
    });

    expect(result.totalCount).toBe(30);
    expect(result.matches).toHaveLength(SEARCH_LIMITS.maxMatches);
    expect(read).toHaveLength(SEARCH_LIMITS.maxMatches);
  });

  it("agrees with searchFiles on the same corpus", () => {
    const files: [string, string][] = [["src/a.ts", `a${"-".repeat(300)}a`]];
    const byPath = new Map(files);

    expect(searchMatchedPaths("a", ["src/a.ts"], (path) => byPath.get(path)!)).toEqual(
      searchFiles("a", files),
    );
  });
});
