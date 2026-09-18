import { describe, expect, it } from "vitest";
import {
  batchRows,
  directoryOf,
  escapeLike,
  packageForPath,
  toAreaDescription,
  type AreaRows,
} from "./index-rows.js";

describe("batchRows", () => {
  it("splits into full batches plus a remainder", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const batches = batchRows(rows, 1000);
    expect(batches.map((b) => b.length)).toEqual([1000, 1000, 500]);
    expect(batches.flat()).toEqual(rows);
  });

  it("returns nothing for no rows and one batch for a short list", () => {
    expect(batchRows([], 1000)).toEqual([]);
    expect(batchRows(["a", "b"], 1000)).toEqual([["a", "b"]]);
  });

  it("rejects a size below one", () => {
    expect(() => batchRows([1], 0)).toThrow(/at least 1/);
  });
});

describe("directoryOf", () => {
  it("keeps the trailing slash and is empty at the repository root", () => {
    expect(directoryOf("packages/db/src/schema.ts")).toBe("packages/db/src/");
    expect(directoryOf("README.md")).toBe("");
    expect(directoryOf("packages/db/")).toBe("packages/db/");
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("a_b%c")).toBe("a\\_b\\%c");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("packages/db/")).toBe("packages/db/");
  });
});

describe("packageForPath", () => {
  const packages = [
    { root: "", name: "root" },
    { root: "packages/db", name: "@pr-review/db" },
    { root: "packages/db/tools", name: "@pr-review/db-tools" },
  ];

  it("picks the innermost root", () => {
    expect(packageForPath(packages, "packages/db/src/schema.ts")?.name).toBe(
      "@pr-review/db",
    );
    expect(packageForPath(packages, "packages/db/tools/x.ts")?.name).toBe(
      "@pr-review/db-tools",
    );
  });

  it("falls back to the root package and to null without one", () => {
    expect(packageForPath(packages, "docs/specs/repo-index.md")?.name).toBe(
      "root",
    );
    expect(packageForPath([{ root: "apps/web" }], "docs/x.md")).toBeNull();
  });

  it("does not match a sibling directory sharing a prefix", () => {
    expect(
      packageForPath([{ root: "packages/db" }], "packages/dbx/a.ts"),
    ).toBeNull();
  });
});

const SOURCE_FILE = "packages/db/src/schema.ts";
const TEST_FILE = "packages/db/src/schema.test.ts";
const OTHER_TEST_FILE = "packages/db/src/other.test.ts";

describe("toAreaDescription", () => {
  const base: AreaRows = {
    path: SOURCE_FILE,
    fileId: 7,
    role: "source",
    language: "typescript",
    owners: ["@team/db"],
    package: {
      name: "@pr-review/db",
      root: "packages/db",
      entryPoints: ["src/index.ts"],
      dependsOn: [],
    },
    testEdges: [
      { src: 8, dst: 7, testPath: TEST_FILE, sourcePath: SOURCE_FILE },
      { src: 9, dst: 7, testPath: OTHER_TEST_FILE, sourcePath: SOURCE_FILE },
      { src: 8, dst: 7, testPath: TEST_FILE, sourcePath: SOURCE_FILE },
    ],
    siblings: ["packages/db/src/client.ts"],
    siblingsTotal: 4,
  };

  it("reads inbound edges as tests, sorted and deduplicated", () => {
    const area = toAreaDescription(base);
    expect(area.known).toBe(true);
    expect(area.tests).toEqual([OTHER_TEST_FILE, TEST_FILE]);
    expect(area.covers).toEqual([]);
    expect(area.role).toBe("source");
    expect(area.package?.name).toBe("@pr-review/db");
    expect(area.siblings).toEqual(["packages/db/src/client.ts"]);
    expect(area.siblingsTotal).toBe(4);
  });

  it("reads outbound edges as covers when the file is the test", () => {
    const area = toAreaDescription({
      ...base,
      path: TEST_FILE,
      fileId: 8,
      role: "test",
    });
    expect(area.covers).toEqual([SOURCE_FILE]);
    expect(area.tests).toEqual([]);
  });

  it("marks an unknown path but keeps its package and siblings", () => {
    const area = toAreaDescription({
      ...base,
      path: "packages/db/src/new-file.ts",
      fileId: null,
      role: null,
      language: null,
      owners: [],
      testEdges: [],
    });
    expect(area.known).toBe(false);
    expect(area.tests).toEqual([]);
    expect(area.covers).toEqual([]);
    expect(area.package?.name).toBe("@pr-review/db");
    expect(area.siblingsTotal).toBe(4);
  });
});
