import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import { exportStyleOf } from "#src/exports";

describe("exportStyleOf", () => {
  it.each([
    ["export default function page() {}\n", "default"],
    ["export default class Store {}\n", "default"],
    ["const a = 1;\nexport { a as default };\n", "default"],
    ["module.exports = { a };\n", "default"],
    ["export = Thing;\n", "default"],
    ["export interface Props {}\nexport default function Button() {}\n", "default"],
    ["export function findInvoice() {}\n", "named"],
    ["export const a = 1;\n", "named"],
    ["export async function load() {}\n", "named"],
    ["export type Id = string;\n", "named"],
    ["const a = 1;\nexport { a };\n", "named"],
    ['export * from "./a";\n', "named"],
    ["exports.handler = () => {};\n", "named"],
  ])("reads %j as %s", (source, style) => {
    expect(exportStyleOf(source)).toBe(style);
  });

  it("is undefined for a module that exports nothing", () => {
    expect(exportStyleOf('import "./setup";\nrun();\n')).toBeUndefined();
  });

  it("ignores exports written in comments and strings", () => {
    const source = [
      "// export default nothing",
      'const doc = "export default x";',
      "export function real() {}",
      "",
    ].join("\n");
    expect(exportStyleOf(source)).toBe("named");
  });
});

describe("the index's export style", () => {
  it("is recorded for the indexed languages only", () => {
    const index = buildRepositoryIndex({
      sha: "0".repeat(40),
      files: new Map([
        ["src/a.ts", "export default 1;\n"],
        ["src/b.js", "export const b = 1;\n"],
        ["src/c.py", "export default 1\n"],
        ["src/d.ts", "const d = 1;\n"],
      ]),
    });

    expect(index.files.get("src/a.ts")?.exportStyle).toBe("default");
    expect(index.files.get("src/b.js")?.exportStyle).toBe("named");
    expect(index.files.get("src/c.py")?.exportStyle).toBeUndefined();
    expect(index.files.get("src/d.ts")).not.toHaveProperty("exportStyle");
  });
});
