import { describe, expect, it } from "vitest";

import { globToRegExp, matchesAny } from "#src/glob";

describe("globToRegExp", () => {
  it("matches ** across directories and * within one", () => {
    expect(globToRegExp("packages/*/src/**").test("packages/db/src/a/b.ts")).toBe(true);
    expect(globToRegExp("packages/*/src/**").test("packages/db/a.ts")).toBe(false);
    expect(globToRegExp("**/index.ts").test("index.ts")).toBe(true);
    expect(globToRegExp("**/index.ts").test("a/b/index.ts")).toBe(true);
    expect(globToRegExp("**/index.ts").test("a/b/index.tsx")).toBe(false);
  });

  it("expands braces and escapes dots", () => {
    expect(globToRegExp("app/**/{page,layout}.tsx").test("app/x/page.tsx")).toBe(true);
    expect(globToRegExp("app/**/{page,layout}.tsx").test("app/x/pagextsx")).toBe(false);
  });

  it("matchesAny takes the first hit", () => {
    expect(matchesAny("tooling/debt/src/cli.ts", ["evals/fixtures/**", "tooling/**"])).toBe(true);
    expect(matchesAny("packages/db/src/x.ts", ["evals/fixtures/**", "tooling/**"])).toBe(false);
  });
});
