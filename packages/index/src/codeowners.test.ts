/** CODEOWNERS parsing and matching, against GitHub's documented behaviour. */
import { describe, expect, it } from "vitest";

import {
  findCodeowners,
  ownersOf,
  parseCodeowners,
} from "#src/codeowners";

function owners(text: string, path: string): string[] {
  return ownersOf(parseCodeowners(text), path);
}

describe("ownersOf", () => {
  it("anchors a leading slash to the root and floats a bare name", () => {
    expect(owners("/build.ts @root", "build.ts")).toEqual(["@root"]);
    expect(owners("/build.ts @root", "src/build.ts")).toEqual([]);
    expect(owners("build.ts @any", "src/deep/build.ts")).toEqual(["@any"]);
  });

  it("anchors a pattern with a slash in the middle", () => {
    expect(owners("src/util.ts @a", "src/util.ts")).toEqual(["@a"]);
    expect(owners("src/util.ts @a", "lib/src/util.ts")).toEqual([]);
  });

  it("owns everything under a trailing-slash directory, at any depth unless anchored", () => {
    expect(owners("apps/ @octocat", "apps/web/page.tsx")).toEqual(["@octocat"]);
    expect(owners("apps/ @octocat", "packages/apps/x.ts")).toEqual(["@octocat"]);
    expect(owners("apps/ @octocat", "apps")).toEqual([]);
    expect(owners("/docs/ @doctocat", "docs/a/b.md")).toEqual(["@doctocat"]);
    expect(owners("/docs/ @doctocat", "src/docs/b.md")).toEqual([]);
  });

  it("owns what is under a directory named without a trailing slash", () => {
    expect(owners("/apps/github @g", "apps/github/src/x.ts")).toEqual(["@g"]);
    expect(owners("/apps/github @g", "apps/github")).toEqual(["@g"]);
    expect(owners("/apps/github @g", "apps/githubber/x.ts")).toEqual([]);
    expect(owners("**/logs @o", "deeply/nested/logs/a.log")).toEqual(["@o"]);
    expect(owners("**/logs @o", "logs/a.log")).toEqual(["@o"]);
  });

  it("keeps `*` inside one segment and lets `**` cross them", () => {
    expect(owners("docs/* @one", "docs/start.md")).toEqual(["@one"]);
    expect(owners("docs/* @one", "docs/build-app/trouble.md")).toEqual([]);
    expect(owners("docs/** @all", "docs/build-app/trouble.md")).toEqual(["@all"]);
    expect(owners("src/*.ts @a", "src/x/a.ts")).toEqual([]);
    expect(owners("*.js @js", "a/b/c.js")).toEqual(["@js"]);
    expect(owners("* @everyone", "a/b/c.go")).toEqual(["@everyone"]);
    expect(owners("a/**/b @x", "a/b")).toEqual(["@x"]);
    expect(owners("a/**/b @x", "a/x/y/b")).toEqual(["@x"]);
    expect(owners("a/**/b @x", "c/a/x/b")).toEqual([]);
  });

  it("matches `?` against exactly one character, never a slash", () => {
    expect(owners("file?.ts @q", "file1.ts")).toEqual(["@q"]);
    expect(owners("file?.ts @q", "file10.ts")).toEqual([]);
    expect(owners("a?b @q", "a/b")).toEqual([]);
  });

  it("reads regex metacharacters literally and paths case-sensitively", () => {
    expect(owners("*.md @d", "readmeXmd")).toEqual([]);
    expect(owners("c++/ @cpp", "c++/main.cc")).toEqual(["@cpp"]);
    expect(owners("c++/ @cpp", "ccc/main.cc")).toEqual([]);
    expect(owners("/$(name).txt @t", "$(name).txt")).toEqual(["@t"]);
    expect(owners("/Docs/ @d", "docs/a.md")).toEqual([]);
  });

  it("reads a backslash-escaped space as part of the pattern", () => {
    expect(owners("my\\ file.txt @s", "my file.txt")).toEqual(["@s"]);
  });

  it("lets the last matching rule win", () => {
    const text = "* @global\n*.js @js-owner\n";

    expect(owners(text, "src/app.js")).toEqual(["@js-owner"]);
    expect(owners(text, "src/app.go")).toEqual(["@global"]);
  });

  it("un-assigns a path whose last matching rule names no owners", () => {
    const text = "/apps/ @octocat\n/apps/github\n";

    expect(owners(text, "apps/github/x.ts")).toEqual([]);
    expect(owners(text, "apps/web/x.ts")).toEqual(["@octocat"]);
  });

  it("keeps team owners as written and returns a fresh array", () => {
    const rules = parseCodeowners("*.txt @Octo-Org/Octocats @Alice\n");
    const found = ownersOf(rules, "notes.txt");
    found.push("@mallory");

    expect(ownersOf(rules, "notes.txt")).toEqual(["@Octo-Org/Octocats", "@Alice"]);
  });
});

describe("parseCodeowners", () => {
  it("ignores blank lines, full-line comments and trailing comments", () => {
    const rules = parseCodeowners(
      [
        "# Default owners",
        "",
        "   ",
        "  # indented comment",
        "*       @global-owner1 @global-owner2",
        "*.js    @js-owner #This is an inline comment.",
        "/build/logs/ @doctocat # another @not-an-owner",
        "/apps/github # nobody",
      ].join("\r\n"),
    );

    expect(rules.map(({ pattern, owners }) => ({ pattern, owners }))).toEqual([
      { pattern: "*", owners: ["@global-owner1", "@global-owner2"] },
      { pattern: "*.js", owners: ["@js-owner"] },
      { pattern: "/build/logs/", owners: ["@doctocat"] },
      { pattern: "/apps/github", owners: [] },
    ]);
  });

  it("drops email owners, keeping the rule so it still takes precedence", () => {
    const text = "* @global\n*.go docs@example.com @gopher\n*.md docs@example.com\n";

    expect(owners(text, "main.go")).toEqual(["@gopher"]);
    expect(owners(text, "README.md")).toEqual([]);
  });

  it("skips negated and character-class lines", () => {
    const text = "/apps/ @octocat\n!/apps/secret @nobody\n*.[jt]s @scripts\n";

    expect(parseCodeowners(text).map((rule) => rule.pattern)).toEqual(["/apps/"]);
    expect(owners(text, "apps/secret/key.ts")).toEqual(["@octocat"]);
  });
});

describe("findCodeowners", () => {
  const all = {
    ".github/CODEOWNERS": "github",
    CODEOWNERS: "root",
    "docs/CODEOWNERS": "docs",
  };

  it("prefers .github/, then the root, then docs/", () => {
    expect(findCodeowners(new Map(Object.entries(all)))).toBe("github");

    const { ".github/CODEOWNERS": _github, ...rootAndDocs } = all;
    expect(findCodeowners(new Map(Object.entries(rootAndDocs)))).toBe("root");
    expect(findCodeowners(new Map([["docs/CODEOWNERS", "docs"]]))).toBe("docs");
  });

  it("finds nothing outside those three locations", () => {
    expect(findCodeowners(new Map([["src/CODEOWNERS", "* @a"]]))).toBeUndefined();
    expect(findCodeowners(new Map())).toBeUndefined();
  });
});
