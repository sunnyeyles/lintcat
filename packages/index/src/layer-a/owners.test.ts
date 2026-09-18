/** CODEOWNERS: the last matching rule wins, and anchoring decides who matches. */
import { describe, expect, it } from "vitest";

import { parseCodeowners, ownersOf } from "./owners.js";

const CODEOWNERS = `
# Owners of everything, unless a later rule says otherwise.
*                       @org/everyone
*.js                    @org/js  ci@example.com

/docs/                  @org/docs
docs/*                  @org/docs-direct
apps/web/**             @org/web
**/migrations           @org/dba
/build/logs             @org/logs
secrets.json
`;

const rules = parseCodeowners(CODEOWNERS);

describe("parseCodeowners", () => {
  it("drops comments and blank lines, keeping file order", () => {
    expect(rules.map((rule) => rule.pattern)).toEqual([
      "*",
      "*.js",
      "/docs/",
      "docs/*",
      "apps/web/**",
      "**/migrations",
      "/build/logs",
      "secrets.json",
    ]);
  });

  it("keeps every owner on the line", () => {
    expect(rules[1]?.owners).toEqual(["@org/js", "ci@example.com"]);
  });
});

describe("ownersOf", () => {
  it("falls back to the catch-all rule", () => {
    expect(ownersOf("packages/index/src/build.ts", rules)).toEqual(["@org/everyone"]);
  });

  it("lets the last matching rule win", () => {
    expect(ownersOf("scripts/build.js", rules)).toEqual(["@org/js", "ci@example.com"]);
  });

  it("anchors a leading slash to the repository root", () => {
    expect(ownersOf("docs/specs/repo-index.md", rules)).toEqual(["@org/docs"]);
    expect(ownersOf("packages/db/docs/schema.md", rules)).toEqual(["@org/everyone"]);
  });

  it("limits a trailing single star to one directory", () => {
    expect(ownersOf("docs/readme.md", rules)).toEqual(["@org/docs-direct"]);
  });

  it("crosses directories only for **", () => {
    expect(ownersOf("apps/web/src/app/page.tsx", rules)).toEqual(["@org/web"]);
    expect(ownersOf("packages/db/migrations/001.sql", rules)).toEqual(["@org/dba"]);
  });

  it("matches a directory pattern's contents", () => {
    expect(ownersOf("build/logs/today.log", rules)).toEqual(["@org/logs"]);
  });

  it("returns no owners when a rule names none", () => {
    expect(ownersOf("secrets.json", rules)).toEqual([]);
  });

  it("returns no owners when nothing matches", () => {
    expect(ownersOf("src/app.ts", parseCodeowners("/docs/ @org/docs"))).toEqual([]);
  });
});
