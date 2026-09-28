import { describe, expect, it } from "vitest";

import { findRuleDocs, governs, isRuleDoc } from "#src/rule-docs";

describe("isRuleDoc", () => {
  it("knows the three rule docs by name, in any case and at any depth", () => {
    expect(isRuleDoc("CLAUDE.md")).toBe(true);
    expect(isRuleDoc("packages/api/AGENTS.md")).toBe(true);
    expect(isRuleDoc(".github/contributing.md")).toBe(true);
    expect(isRuleDoc("README.md")).toBe(false);
    expect(isRuleDoc("docs/CLAUDE.md.bak")).toBe(false);
  });
});

describe("governs", () => {
  it("applies a doc to the files under its directory", () => {
    expect(governs("CLAUDE.md", "src/a.ts")).toBe(true);
    expect(governs("packages/api/AGENTS.md", "packages/api/src/a.ts")).toBe(true);
    expect(governs("packages/api/AGENTS.md", "packages/web/src/a.ts")).toBe(false);
  });

  it("treats a CONTRIBUTING.md in .github or docs as the root's", () => {
    expect(governs(".github/CONTRIBUTING.md", "src/a.ts")).toBe(true);
    expect(governs("docs/CONTRIBUTING.md", "src/a.ts")).toBe(true);
    expect(governs("docs/AGENTS.md", "src/a.ts")).toBe(false);
  });
});

describe("findRuleDocs", () => {
  it("returns the rule docs shallowest first, cutting a long one", () => {
    const long = "x".repeat(20_000);
    const docs = findRuleDocs(
      new Map([
        ["packages/api/AGENTS.md", long],
        ["src/index.ts", "export {};\n"],
        ["CONTRIBUTING.md", "Be kind.\n"],
        ["AGENTS.md", "Name reads find*.\n"],
      ]),
    );

    expect(docs.map((doc) => doc.path)).toEqual([
      "AGENTS.md",
      "CONTRIBUTING.md",
      "packages/api/AGENTS.md",
    ]);
    expect(docs[0]).toEqual({ path: "AGENTS.md", text: "Name reads find*.\n", truncated: false });
    expect(docs[2]?.truncated).toBe(true);
    expect(docs[2]?.text.length).toBeLessThan(long.length);
  });
});
