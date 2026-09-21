import { describe, expect, it } from "vitest";

import { searchFiles } from "./search";

const files = [
  { path: "apps/web/lib/format.ts" },
  { path: "apps/web/format/index.ts" },
  { path: "packages/db/src/reformat.ts" },
  { path: "packages/db/src/schema.ts" },
];

describe("searchFiles", () => {
  it("ranks a file-name prefix above a path segment above a substring", () => {
    expect(searchFiles(files, "format").map((r) => [r.path, r.kind])).toEqual([
      ["apps/web/lib/format.ts", "name-prefix"],
      ["apps/web/format/index.ts", "segment"],
      ["packages/db/src/reformat.ts", "substring"],
    ]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(searchFiles(files, "  FORMAT.TS  ")[0]?.path).toBe("apps/web/lib/format.ts");
  });

  it("returns nothing for an empty query", () => {
    expect(searchFiles(files, "")).toEqual([]);
    expect(searchFiles(files, "   ")).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchFiles(files, "zzz")).toEqual([]);
  });

  it("orders ties by path, whatever the input order", () => {
    const forwards = searchFiles([{ path: "b/x.ts" }, { path: "a/x.ts" }], "x");
    const backwards = searchFiles([{ path: "a/x.ts" }, { path: "b/x.ts" }], "x");

    expect(forwards.map((r) => r.path)).toEqual(["a/x.ts", "b/x.ts"]);
    expect(backwards.map((r) => r.path)).toEqual(forwards.map((r) => r.path));
  });

  it("caps the result count", () => {
    expect(searchFiles(files, "s", 2)).toHaveLength(2);
    expect(searchFiles(files, "s", 0)).toEqual([]);
  });
});
