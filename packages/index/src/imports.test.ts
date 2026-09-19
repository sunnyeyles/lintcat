/** Import parsing and relative resolution, over inline file maps. */
import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import { parseImports } from "#src/imports";
import { referencesTo } from "#src/references";

const sha = "0000000000000000000000000000000000000000";

function index(files: Record<string, string>) {
  return buildRepositoryIndex({
    sha,
    files: new Map(Object.entries(files)),
  });
}

/** The specifiers one file's contents import, in source order. */
function specifiers(source: string): string[] {
  return parseImports(source).map((parsed) => parsed.specifier);
}

describe("parseImports", () => {
  it.each([
    ["a static import", `import { a } from "./a";`],
    ["a default import", `import a from "./a";`],
    ["a namespace import", `import * as a from "./a";`],
    ["a side-effect import", `import "./a";`],
    ["a type-only import", `import type { A } from "./a";`],
    ["a re-export", `export { a } from "./a";`],
    ["a star re-export", `export * from "./a";`],
    ["a named star re-export", `export * as a from "./a";`],
    ["a dynamic import", `const a = await import("./a");`],
    ["a require call", `const a = require("./a");`],
    ["a single-quoted specifier", `import { a } from './a';`],
    ["a backtick specifier", "const a = require(`./a`);"],
  ])("reads the specifier of %s", (_label, source) => {
    expect(specifiers(source)).toEqual(["./a"]);
  });

  it("reads a clause that spans several lines", () => {
    const parsed = parseImports(`const x = 1;\nimport {\n  a,\n  b,\n} from "./a";\n`);

    expect(parsed).toEqual([
      {
        specifier: "./a",
        line: 2,
        names: [
          { kind: "named", name: "a" },
          { kind: "named", name: "b" },
        ],
      },
    ]);
  });

  it("records the line each specifier sits on", () => {
    const parsed = parseImports(`import "./a";\n\nimport "./b";\n`);

    expect(parsed.map((entry) => entry.line)).toEqual([1, 3]);
  });

  it.each([
    ["named", `import { createSession } from "./a";`, [{ kind: "named", name: "createSession" }]],
    ["aliased named, under the exported name", `import { createSession as make } from "./a";`, [{ kind: "named", name: "createSession" }]],
    ["default", `import make from "./a";`, [{ kind: "default", name: "default" }]],
    ["namespace", `import * as all from "./a";`, [{ kind: "namespace", name: "*" }]],
    ["default and named together", `import make, { createSession } from "./a";`, [
      { kind: "default", name: "default" },
      { kind: "named", name: "createSession" },
    ]],
    ["default and namespace together", `import make, * as all from "./a";`, [
      { kind: "default", name: "default" },
      { kind: "namespace", name: "*" },
    ]],
    ["an inline type specifier", `import { type A, b } from "./a";`, [
      { kind: "named", name: "A" },
      { kind: "named", name: "b" },
    ]],
    ["a renamed default", `import { default as make } from "./a";`, [
      { kind: "default", name: "default" },
    ]],
    ["nothing at all", `import "./a";`, []],
  ])("records %s bindings", (_label, source, names) => {
    expect(parseImports(source)[0]?.names).toEqual(names);
  });

  it("reaches the whole module through a dynamic import", () => {
    expect(parseImports(`await import("./a");`)[0]?.names).toEqual([
      { kind: "namespace", name: "*" },
    ]);
  });

  it.each([
    ["a line comment", `// import { a } from "./a";\n`],
    ["a block comment", `/*\nimport { a } from "./a";\n*/\n`],
    ["a string holding import text", `const s = 'import { a } from "./a"';\n`],
    ["an interpolated specifier", "await import(`./${name}`);\n"],
    ["an empty specifier", `import "";\n`],
  ])("reads no import out of %s", (_label, source) => {
    expect(specifiers(source)).toEqual([]);
  });

  it("is not derailed by an apostrophe inside a regular expression", () => {
    const source = `const re = /don't/;\nimport { a } from "./a";\n`;

    expect(specifiers(source)).toEqual(["./a"]);
  });

  it("is not derailed by an apostrophe in JSX text", () => {
    const source = [
      `import { Card } from "./card";`,
      ``,
      `export function Note() {`,
      `  return <p>Don't do it</p>;`,
      `}`,
      ``,
      `export { helper } from "./helper";`,
      `const lazy = require("./lazy");`,
      ``,
    ].join("\n");

    expect(specifiers(source)).toEqual(["./card", "./helper", "./lazy"]);
  });

  it("does not run an export declaration on into the next statement", () => {
    const source = `export class Thing {}\nimport b from "./b";\n`;

    expect(parseImports(source)).toEqual([
      { specifier: "./b", line: 2, names: [{ kind: "default", name: "default" }] },
    ]);
  });

  it("keeps a bare package specifier as written", () => {
    expect(specifiers(`import { z } from "zod";`)).toEqual(["zod"]);
  });
});

describe("relative resolution", () => {
  it.each([
    ["an extensionless sibling", "./b", "src/b.ts"],
    ["an explicit extension", "./b.ts", "src/b.ts"],
    ["a .js suffix written for a .ts file", "./b.js", "src/b.ts"],
    ["a parent directory", "../root", "root.ts"],
  ])("resolves %s", (_label, specifier, target) => {
    const built = index({
      "src/a.ts": `import "${specifier}";`,
      "src/b.ts": "export const b = 1;\n",
      "root.ts": "export const root = 1;\n",
    });

    expect(built.edges[0]?.to).toBe(target);
  });

  it("resolves a directory through its index file", () => {
    const built = index({
      "src/a.ts": `import "./thing";`,
      "src/thing/index.ts": "export const thing = 1;\n",
    });

    expect(built.edges[0]?.to).toBe("src/thing/index.ts");
  });

  it("resolves a .js suffix to a .tsx file when there is no .ts", () => {
    const built = index({
      "src/a.ts": `import "./view.js";`,
      "src/view.tsx": "export const View = () => null;\n",
    });

    expect(built.edges[0]?.to).toBe("src/view.tsx");
  });

  it("prefers the file that exists over the extension it would add", () => {
    const built = index({
      "src/a.ts": `import "./b.js";`,
      "src/b.js": "module.exports = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });

    expect(built.edges[0]?.to).toBe("src/b.js");
  });

  it.each([
    ["a bare package name", "zod"],
    ["a package-internal alias", "#src/b"],
    ["an app alias", "@/b"],
    ["a relative path with no file behind it", "./nowhere"],
    ["a path climbing above the repository root", "../../escape"],
  ])("leaves %s unresolved rather than guessing", (_label, specifier) => {
    const built = index({
      "src/a.ts": `import "${specifier}";`,
      "src/b.ts": "export const b = 1;\n",
    });

    expect(built.edges).toHaveLength(1);
    expect(built.edges[0]?.to).toBeUndefined();
    expect(built.importers.size).toBe(0);
  });

  it("counts unresolved edges alongside resolved ones", () => {
    const built = index({
      "src/a.ts": `import "./b";\nimport "zod";\nimport "#src/b";\n`,
      "src/b.ts": "export const b = 1;\n",
    });

    expect(built.edges).toHaveLength(3);
    expect(built.edges.filter((edge) => edge.to === undefined)).toHaveLength(2);
  });
});

describe("the import graph", () => {
  const tree = {
    "src/sessions.ts": "export function createSession() {}\nexport const limit = 1;\n",
    "src/api.ts": `import { createSession } from "./sessions";\n`,
    "src/admin.ts": `import * as sessions from "./sessions";\n`,
    "src/boot.ts": `import "./sessions";\n`,
    "src/limits.ts": `import { limit } from "./sessions";\n`,
    "docs/guide.md": "# Guide\n",
  };

  it("reports typescript and javascript as indexed, other languages as seen", () => {
    const built = index({ ...tree, "app/main.py": "import os\n" });
    const coverage = new Map(
      built.coverage.map((entry) => [entry.language, entry.indexed]),
    );

    expect(coverage.get("typescript")).toBe(true);
    expect(coverage.get("python")).toBe(false);
    expect(coverage.get("markdown")).toBe(false);
  });

  it("reports javascript as indexed", () => {
    const built = index({ "src/a.js": `require("./b");`, "src/b.js": "" });

    expect(
      built.coverage.find((entry) => entry.language === "javascript")?.indexed,
    ).toBe(true);
  });

  it("counts the distinct files importing each file", () => {
    const built = index(tree);

    expect(built.files.get("src/sessions.ts")?.importerCount).toBe(4);
    expect(built.files.get("src/api.ts")?.importerCount).toBe(0);
  });

  it("counts a file importing the same target twice once", () => {
    const built = index({
      "src/a.ts": `import { b } from "./b";\nconst late = await import("./b");\n`,
      "src/b.ts": "export const b = 1;\n",
    });

    expect(built.files.get("src/b.ts")?.importerCount).toBe(1);
  });

  it("lists every importer of a file with its lines", () => {
    const built = index(tree);

    expect(referencesTo(built.importers, "src/sessions.ts")).toEqual([
      { path: "src/admin.ts", imports: [{ line: 1, kind: "namespace", name: "*" }] },
      { path: "src/api.ts", imports: [{ line: 1, kind: "named", name: "createSession" }] },
      { path: "src/boot.ts", imports: [{ line: 1, kind: "side-effect" }] },
      { path: "src/limits.ts", imports: [{ line: 1, kind: "named", name: "limit" }] },
    ]);
  });

  it("narrows to one name, keeping the namespace importer that sees it", () => {
    const built = index(tree);

    expect(
      referencesTo(built.importers, "src/sessions.ts", "createSession").map(
        (reference) => reference.path,
      ),
    ).toEqual(["src/admin.ts", "src/api.ts"]);
  });

  it("keeps a default importer under the name default", () => {
    const built = index({
      "src/a.ts": "export default function make() {}\n",
      "src/b.ts": `import make from "./a";\n`,
    });

    expect(referencesTo(built.importers, "src/a.ts", "default")).toEqual([
      { path: "src/b.ts", imports: [{ line: 1, kind: "default", name: "default" }] },
    ]);
  });

  it("drops a side-effect importer from a name query", () => {
    const built = index(tree);

    expect(
      referencesTo(built.importers, "src/sessions.ts", "limit").map(
        (reference) => reference.path,
      ),
    ).toEqual(["src/admin.ts", "src/limits.ts"]);
  });

  it("gathers several statements from one importing file", () => {
    const built = index({
      "src/a.ts": "export const one = 1;\nexport const two = 2;\n",
      "src/b.ts": `import { one } from "./a";\nimport { two } from "./a";\n`,
    });

    expect(referencesTo(built.importers, "src/a.ts")).toEqual([
      {
        path: "src/b.ts",
        imports: [
          { line: 1, kind: "named", name: "one" },
          { line: 2, kind: "named", name: "two" },
        ],
      },
    ]);
  });

  it("has nothing to say about a path outside the index", () => {
    expect(referencesTo(index(tree).importers, "src/missing.ts")).toEqual([]);
  });

  it("does not count a file importing itself", () => {
    const built = index({ "src/a.ts": `import "./a";\n` });

    expect(built.files.get("src/a.ts")?.importerCount).toBe(0);
  });
});
