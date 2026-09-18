import { describe, expect, it } from "vitest";
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCES,
  MAX_SYMBOL_CANDIDATES,
} from "@pr-review/index";
import {
  batchRows,
  directoryOf,
  escapeLike,
  packageForPath,
  readStoredCoverage,
  toAreaDescription,
  toImportersResult,
  toReferencesResult,
  toSymbolDescription,
  toSymbolRecord,
  type AreaRows,
  type SymbolRow,
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

describe("readStoredCoverage", () => {
  const layerA = {
    files: 12,
    truncated: false,
    languages: { typescript: 12 },
    manifests: ["pnpm-workspace"],
  };

  it("reads the Layer B shape back", () => {
    const languages = [
      { language: "typescript", files: 12, indexed: true, resolutionRate: 0.9 },
    ];
    expect(readStoredCoverage({ layerA, languages })).toEqual({
      layerA,
      languages,
    });
  });

  it("reads a build written before Layer B as no languages", () => {
    expect(readStoredCoverage(layerA)).toEqual({ layerA, languages: [] });
  });
});

const symbolRow = (over: Partial<SymbolRow> = {}): SymbolRow => ({
  id: 1,
  path: SOURCE_FILE,
  name: "writeIndex",
  kind: "function",
  line: 40,
  endLine: 90,
  exported: true,
  ...over,
});

describe("toSymbolRecord", () => {
  it("maps the row onto the contract's field names", () => {
    expect(toSymbolRecord(symbolRow())).toEqual({
      id: 1,
      file: SOURCE_FILE,
      name: "writeIndex",
      kind: "function",
      line: 40,
      endLine: 90,
      exported: true,
    });
  });

  it("falls back to unknown for a kind no indexer of ours writes", () => {
    expect(toSymbolRecord(symbolRow({ kind: "trait" })).kind).toBe("unknown");
  });
});

describe("toSymbolDescription", () => {
  it("returns the symbol with its counts", () => {
    const described = toSymbolDescription({
      path: SOURCE_FILE,
      name: "writeIndex",
      symbol: symbolRow(),
      candidates: [symbolRow({ id: 2, path: TEST_FILE })],
      inboundReferences: 7,
      referencingFiles: 3,
    });
    expect(described.known).toBe(true);
    expect(described.symbol?.file).toBe(SOURCE_FILE);
    expect(described.candidates.map((c) => c.file)).toEqual([TEST_FILE]);
    expect(described.inboundReferences).toBe(7);
    expect(described.referencingFiles).toBe(3);
  });

  it("keeps candidates for an unknown path and zeroes the counts", () => {
    const described = toSymbolDescription({
      path: "packages/db/src/gone.ts",
      name: "writeIndex",
      symbol: null,
      candidates: [symbolRow()],
      inboundReferences: 7,
      referencingFiles: 3,
    });
    expect(described.known).toBe(false);
    expect(described.symbol).toBeNull();
    expect(described.candidates.map((c) => c.file)).toEqual([SOURCE_FILE]);
    expect(described.inboundReferences).toBe(0);
    expect(described.referencingFiles).toBe(0);
  });

  it("drops a candidate in the asked-for file and caps the rest", () => {
    const candidates = [
      symbolRow({ id: 99 }),
      ...Array.from({ length: MAX_SYMBOL_CANDIDATES + 5 }, (_, i) =>
        symbolRow({ id: 100 + i, path: `packages/db/src/other-${i}.ts` }),
      ),
    ];
    const described = toSymbolDescription({
      path: SOURCE_FILE,
      name: "writeIndex",
      symbol: symbolRow(),
      candidates,
      inboundReferences: 0,
      referencingFiles: 0,
    });
    expect(described.candidates).toHaveLength(MAX_SYMBOL_CANDIDATES);
    expect(described.candidates.every((c) => c.file !== SOURCE_FILE)).toBe(true);
  });
});

describe("toImportersResult", () => {
  it("deduplicates and caps the list while the total stays exact", () => {
    const importers = Array.from(
      { length: MAX_REFERENCE_FILES + 10 },
      (_, i) => `packages/db/src/importer-${i}.ts`,
    );
    const result = toImportersResult({
      path: SOURCE_FILE,
      known: true,
      importers: [...importers, importers[0] as string],
      totalImporters: 312,
    });
    expect(result.name).toBeNull();
    expect(result.importers).toHaveLength(MAX_REFERENCE_FILES);
    expect(result.totalImporters).toBe(312);
    expect(result.references).toEqual([]);
  });

  it("marks a path the index does not hold", () => {
    const result = toImportersResult({
      path: "packages/db/src/gone.ts",
      known: false,
      importers: [],
      totalImporters: 0,
    });
    expect(result.known).toBe(false);
    expect(result.importers).toEqual([]);
  });
});

describe("toReferencesResult", () => {
  const base = {
    path: SOURCE_FILE,
    name: "writeIndex",
    known: true,
    totalReferences: 4,
    totalFiles: 2,
  };

  it("groups by file in row order and drops a repeated line", () => {
    const result = toReferencesResult({
      ...base,
      references: [
        { path: OTHER_TEST_FILE, line: 3 },
        { path: OTHER_TEST_FILE, line: 3 },
        { path: OTHER_TEST_FILE, line: 9 },
        { path: TEST_FILE, line: 12 },
      ],
    });
    expect(result.references).toEqual([
      { file: OTHER_TEST_FILE, lines: [3, 9] },
      { file: TEST_FILE, lines: [12] },
    ]);
    expect(result.totalReferences).toBe(4);
    expect(result.totalFiles).toBe(2);
    expect(result.importers).toEqual([]);
  });

  it("keeps a file whose edge carries no line", () => {
    const result = toReferencesResult({
      ...base,
      references: [{ path: TEST_FILE, line: null }],
    });
    expect(result.references).toEqual([{ file: TEST_FILE, lines: [] }]);
  });

  it("caps the files it returns", () => {
    const references = Array.from(
      { length: MAX_REFERENCE_FILES + 10 },
      (_, i) => ({ path: `packages/db/src/user-${i}.ts`, line: 1 }),
    );
    const result = toReferencesResult({ ...base, references });
    expect(result.references).toHaveLength(MAX_REFERENCE_FILES);
  });

  it("caps the references it returns while the totals stay exact", () => {
    const references = Array.from({ length: MAX_REFERENCES + 50 }, (_, i) => ({
      path: TEST_FILE,
      line: i + 1,
    }));
    const result = toReferencesResult({
      ...base,
      references,
      totalReferences: 4000,
      totalFiles: 1,
    });
    expect(result.references[0]?.lines).toHaveLength(MAX_REFERENCES);
    expect(result.totalReferences).toBe(4000);
    expect(result.totalFiles).toBe(1);
  });

  it("returns nothing for a symbol the index does not hold", () => {
    const result = toReferencesResult({
      ...base,
      known: false,
      references: [],
      totalReferences: 0,
      totalFiles: 0,
    });
    expect(result.known).toBe(false);
    expect(result.references).toEqual([]);
    expect(result.name).toBe("writeIndex");
  });
});
