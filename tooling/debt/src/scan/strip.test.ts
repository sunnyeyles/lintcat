import { describe, expect, it } from "vitest";

import { stripNonCode } from "#src/scan/strip";

describe("stripNonCode", () => {
  it("blanks line and block comments but keeps line numbers", () => {
    const source = "const a = 1; // trailing!\n/* block\n with lines! */\nconst b = a!;\n";
    const out = stripNonCode(source);
    expect(out.split("\n").length).toBe(source.split("\n").length);
    expect(out).not.toContain("trailing");
    expect(out).not.toContain("lines!");
    expect(out).toContain("const b = a!;");
  });

  it("blanks string contents and keeps the quotes", () => {
    expect(stripNonCode(`const s = "Done!"; const t = 'x!';`)).toBe(`const s = "     "; const t = '  ';`);
  });

  it("keeps template expressions as code", () => {
    const out = stripNonCode("const s = `hi ${name!} there!`;");
    expect(out).toContain("${name!}");
    expect(out).not.toContain("there!");
  });

  it("honours escapes inside strings", () => {
    expect(stripNonCode(`"a\\"b!" + c!`)).toBe(`"     " + c!`);
  });
});
