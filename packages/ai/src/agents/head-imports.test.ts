import { describe, expect, it } from "vitest";

import { renderHeadImports } from "#src/agents/head-imports";

describe("renderHeadImports", () => {
  it("renders nothing without resolved imports", () => {
    expect(renderHeadImports(undefined)).toEqual([]);
    expect(renderHeadImports(new Map())).toEqual([]);
  });

  it("lists internal imports with their target and leaves third-party ones out", () => {
    const lines = renderHeadImports(
      new Map([
        [
          "src/page.ts",
          [
            { specifier: "#src/cn", line: 1, path: "src/cn.ts", internal: true },
            { specifier: "./gone", line: 2, internal: true },
            { specifier: "react", line: 3, internal: false },
          ],
        ],
      ]),
    );

    expect(lines).toContain("- src/page.ts");
    expect(lines).toContain('  - line 1 "#src/cn" → src/cn.ts');
    expect(lines).toContain('  - line 2 "./gone" → unresolved');
    expect(lines.join("\n")).not.toContain("react");
  });

  it("omits a file whose imports are all third-party", () => {
    const lines = renderHeadImports(
      new Map([["src/a.ts", [{ specifier: "react", line: 1, internal: false }]]]),
    );

    expect(lines).toEqual([]);
  });
});
