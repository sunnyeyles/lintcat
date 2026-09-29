import type { ChangedFile } from "@pr-review/github";
import { buildRepositoryIndex } from "@pr-review/index";
import { describe, expect, it } from "vitest";

import { renderLintConfig, renderRuleDocs } from "#src/agents/repo-rules";

const index = buildRepositoryIndex({
  sha: "0".repeat(40),
  files: new Map([
    ["CLAUDE.md", "# Rules\n\n- Reads are named find*.\n"],
    [".github/CONTRIBUTING.md", "Open an issue first.\n"],
    ["packages/api/AGENTS.md", "- Routes never touch the db.\n"],
    ["packages/web/AGENTS.md", "- Components are PascalCase.\n"],
    ["package.json", JSON.stringify({ scripts: { lint: "eslint .", build: "tsc" } })],
    ["packages/api/eslint.config.js", "export default [{ rules: { eqeqeq: 'error' } }];\n"],
    ["packages/web/.prettierrc", '{ "semi": false }\n'],
    ["packages/api/src/routes.ts", "export {};\n"],
  ]),
});

function changed(...paths: string[]): { changedFiles: ChangedFile[] } {
  return {
    changedFiles: paths.map((filename) => ({
      filename,
      status: "modified",
      additions: 1,
      deletions: 0,
    })),
  };
}

describe("renderRuleDocs", () => {
  it("numbers each governing doc's lines, the root's first", () => {
    const block = renderRuleDocs(index, changed("packages/api/src/routes.ts"), true).join("\n");

    expect(block).toContain(
      '<rule_doc path="CLAUDE.md">\n1| # Rules\n2| \n3| - Reads are named find*.\n</rule_doc>\n' +
        '<rule_doc path=".github/CONTRIBUTING.md">\n1| Open an issue first.\n</rule_doc>\n' +
        '<rule_doc path="packages/api/AGENTS.md">\n1| - Routes never touch the db.\n</rule_doc>',
    );
    expect(block).not.toContain("packages/web/AGENTS.md");
  });

  it("leaves out a doc this pull request edits, which it cannot cite", () => {
    const block = renderRuleDocs(
      index,
      changed("packages/api/src/routes.ts", "CLAUDE.md"),
      true,
    ).join("\n");

    expect(block).not.toContain('path="CLAUDE.md"');
    expect(block).toContain('path="packages/api/AGENTS.md"');
  });

  it("cuts the docs at the character budget and names the ones it could not start", () => {
    const long = "- A rule that goes on and on.\n".repeat(600);
    const crowded = buildRepositoryIndex({
      sha: "0".repeat(40),
      files: new Map([
        ["AGENTS.md", long],
        ["src/AGENTS.md", "- Late rule.\n"],
      ]),
    });

    const withTools = renderRuleDocs(crowded, changed("src/a.ts"), true).join("\n");
    expect(withTools.length).toBeLessThan(long.length);
    expect(withTools).toMatch(/\[\.\.\. truncated at line \d+; get_file returns the whole file\]/);
    expect(withTools).toContain("[... 1 more rule docs: src/AGENTS.md]");

    const withoutTools = renderRuleDocs(crowded, changed("src/a.ts"), false).join("\n");
    expect(withoutTools).toMatch(/truncated at line \d+; the rest is not shown/);
  });

  it("renders nothing without an index or a governing doc", () => {
    expect(renderRuleDocs(undefined, changed("src/a.ts"), true)).toEqual([]);
    const bare = buildRepositoryIndex({ sha: "0".repeat(40), files: new Map([["a.ts", ""]]) });
    expect(renderRuleDocs(bare, changed("a.ts"), true)).toEqual([]);
  });
});

describe("renderLintConfig", () => {
  it("lists the configs governing the reviewed files, with their excerpts", () => {
    expect(renderLintConfig(index, changed("packages/api/src/routes.ts"))).toEqual([
      "<lint_config>",
      "What the repository's own linter, formatter and typecheck enforce, from their configuration at the base commit. Anything these catch is out of scope.",
      "- package.json scripts (package.json):",
      "    lint: eslint .",
      "- ESLint (packages/api/eslint.config.js):",
      "    export default [{ rules: { eqeqeq: 'error' } }];",
      "</lint_config>",
      "",
    ]);
  });

  it("renders nothing when no config governs the reviewed files", () => {
    const bare = buildRepositoryIndex({ sha: "0".repeat(40), files: new Map([["a.ts", ""]]) });
    expect(renderLintConfig(bare, changed("a.ts"))).toEqual([]);
    expect(renderLintConfig(undefined, changed("a.ts"))).toEqual([]);
  });
});
