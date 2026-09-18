/** describeArea over a built index: known paths, unknown paths, and the caps. */
import { describe, expect, it } from "vitest";

import { buildLayerA } from "./build.js";
import { createInMemoryIndex } from "./memory.js";
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCES,
  MAX_SIBLINGS,
  MAX_SYMBOL_CANDIDATES,
  type FileSource,
  type ImportEdge,
  type ReferenceRecord,
  type SymbolRecord,
} from "./types.js";

const FILES: Record<string, string> = {
  "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
  "package.json": JSON.stringify({ name: "root", private: true }),
  CODEOWNERS: "packages/api/** @org/api\n",
  "packages/api/package.json": JSON.stringify({ name: "@acme/api", main: "src/index.ts" }),
  "packages/api/src/index.ts": "",
  "packages/api/src/routes.ts": "",
  "packages/api/src/routes.test.ts": "",
  "README.md": "",
};
for (let n = 0; n < 40; n += 1) {
  FILES[`packages/api/src/gen/f${n}.ts`] = "";
}

const source: FileSource = {
  sha: "abc123",
  listPaths: () => Promise.resolve({ paths: Object.keys(FILES).sort(), truncated: false }),
  read: (path: string) => Promise.resolve(FILES[path]),
};

const index = createInMemoryIndex(
  await buildLayerA(source, new Date("2026-02-03T04:05:06.000Z")),
);

describe("createInMemoryIndex", () => {
  it("reports the build it serves", async () => {
    const status = await index.status();
    expect(status.sha).toBe("abc123");
    expect(status.builtAt).toBe("2026-02-03T04:05:06.000Z");
    expect(status.coverage.files).toBe(Object.keys(FILES).length);
  });

  it("fills every field for a known path", async () => {
    const area = await index.describeArea("packages/api/src/routes.ts");
    expect(area).toEqual({
      path: "packages/api/src/routes.ts",
      known: true,
      package: {
        name: "@acme/api",
        root: "packages/api",
        entryPoints: ["packages/api/src/index.ts"],
        dependsOn: [],
      },
      role: "source",
      language: "typescript",
      owners: ["@org/api"],
      tests: ["packages/api/src/routes.test.ts"],
      covers: [],
      siblings: [
        "packages/api/src/index.ts",
        "packages/api/src/routes.test.ts",
      ],
      siblingsTotal: 2,
    });
  });

  it("reports what a test file covers", async () => {
    const area = await index.describeArea("packages/api/src/routes.test.ts");
    expect(area.role).toBe("test");
    expect(area.covers).toEqual(["packages/api/src/routes.ts"]);
    expect(area.tests).toEqual([]);
  });

  it("caps siblings while keeping the total exact", async () => {
    const area = await index.describeArea("packages/api/src/gen/f0.ts");
    expect(area.siblings).toHaveLength(MAX_SIBLINGS);
    expect(area.siblingsTotal).toBe(39);
    expect(area.siblings[0]).toBe("packages/api/src/gen/f1.ts");
  });

  it("answers an unknown path with its package and its directory", async () => {
    const area = await index.describeArea("packages/api/src/added.ts");
    expect(area.known).toBe(false);
    expect(area.package?.name).toBe("@acme/api");
    expect(area.role).toBeNull();
    expect(area.language).toBeNull();
    expect(area.owners).toEqual([]);
    expect(area.tests).toEqual([]);
    expect(area.siblings).toContain("packages/api/src/routes.ts");
    expect(area.siblingsTotal).toBe(3);
  });

  it("answers an unknown directory with nothing", async () => {
    const area = await index.describeArea("apps/web/src/page.tsx");
    expect(area.known).toBe(false);
    expect(area.package).toBeNull();
    expect(area.siblings).toEqual([]);
    expect(area.siblingsTotal).toBe(0);
  });

  it("rejects absolute and traversing paths", async () => {
    for (const path of ["/etc/passwd", "../secrets.ts", "packages/api/../../x.ts", ""]) {
      const area = await index.describeArea(path);
      expect(area.known).toBe(false);
      expect(area.package).toBeNull();
      expect(area.siblings).toEqual([]);
    }
  });
});

const GRAPH_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "graph" }),
  "a.ts": "",
  "b.ts": "",
  "c.ts": "",
  "README.md": "",
};

const graphSource: FileSource = {
  sha: "graph1",
  listPaths: () =>
    Promise.resolve({ paths: Object.keys(GRAPH_FILES).sort(), truncated: false }),
  read: (path: string) => Promise.resolve(GRAPH_FILES[path]),
};

function symbol(
  id: number,
  file: string,
  name: string,
  line: number,
  exported: boolean,
): SymbolRecord {
  return { id, file, name, kind: "function", line, endLine: line + 2, exported };
}

const REFERENCE_FILES = 60;
const LINES_PER_FILE = 5;
const IMPORTER_FILES = 55;

const symbols: SymbolRecord[] = [
  symbol(0, "a.ts", "greet", 1, true),
  symbol(1, "a.ts", "greet", 20, false),
  symbol(2, "b.ts", "greet", 2, true),
  symbol(3, "a.ts", "Greeter", 5, true),
  symbol(4, "c.ts", "dup", 7, false),
  symbol(5, "c.ts", "dup", 3, false),
  symbol(6, "a.ts", "widget", 30, true),
];
for (let n = 0; n < MAX_SYMBOL_CANDIDATES + 2; n += 1) {
  symbols.push(symbol(symbols.length, `w${n}.ts`, "widget", 1, true));
}

const references: ReferenceRecord[] = [];
for (let file = 0; file < REFERENCE_FILES; file += 1) {
  for (let line = 1; line <= LINES_PER_FILE; line += 1) {
    references.push({ symbol: 0, file: `g${file}.ts`, line: LINES_PER_FILE + 1 - line });
  }
}
references.push({ symbol: 3, file: "b.ts", line: 9 }, { symbol: 3, file: "b.ts", line: 4 });

const imports: ImportEdge[] = [
  { from: "c.ts", to: "a.ts" },
  { from: "b.ts", to: "a.ts" },
];
for (let n = 0; n < IMPORTER_FILES; n += 1) {
  imports.push({ from: `h${n}.ts`, to: "b.ts" });
}

const graph = createInMemoryIndex({
  ...(await buildLayerA(graphSource, new Date("2026-02-03T04:05:06.000Z"))),
  layerB: {
    symbols,
    references,
    imports,
    coverage: [
      { language: "typescript", files: 3, indexed: true, resolutionRate: 0.5 },
      { language: "javascript", files: 0, indexed: true, resolutionRate: 0 },
    ],
  },
});

describe("getSymbol", () => {
  it("prefers the exported definition and counts its references", async () => {
    const found = await graph.getSymbol("a.ts", "greet");
    expect(found.known).toBe(true);
    expect(found.symbol).toMatchObject({ id: 0, line: 1, exported: true });
    expect(found.inboundReferences).toBe(REFERENCE_FILES * LINES_PER_FILE);
    expect(found.referencingFiles).toBe(REFERENCE_FILES);
    expect(found.candidates).toEqual([symbols[2]]);
  });

  it("takes the first by line when none is exported", async () => {
    expect((await graph.getSymbol("c.ts", "dup")).symbol).toMatchObject({ id: 5, line: 3 });
  });

  it("caps the candidates from other files", async () => {
    const found = await graph.getSymbol("a.ts", "widget");
    expect(found.symbol?.id).toBe(6);
    expect(found.candidates).toHaveLength(MAX_SYMBOL_CANDIDATES);
    expect(found.candidates[0]?.file).toBe("w0.ts");
  });

  it("is unknown for a name the file does not define", async () => {
    const found = await graph.getSymbol("a.ts", "nope");
    expect(found).toMatchObject({ known: false, symbol: null, candidates: [] });
    expect(found.inboundReferences).toBe(0);
  });

  it("still offers candidates for an unknown file", async () => {
    const found = await graph.getSymbol("zzz.ts", "greet");
    expect(found.known).toBe(false);
    expect(found.candidates).toHaveLength(3);
  });

  it("rejects a traversing path", async () => {
    expect(await graph.getSymbol("../a.ts", "greet")).toMatchObject({
      known: false,
      candidates: [],
    });
  });
});

describe("findReferences", () => {
  it("lists the files importing a path", async () => {
    const result = await graph.findReferences("a.ts");
    expect(result).toMatchObject({
      known: true,
      importers: ["b.ts", "c.ts"],
      totalImporters: 2,
      references: [],
      totalReferences: 0,
    });
  });

  it("caps importers while keeping the total exact", async () => {
    const result = await graph.findReferences("b.ts");
    expect(result.importers).toHaveLength(MAX_REFERENCE_FILES);
    expect(result.totalImporters).toBe(IMPORTER_FILES);
  });

  it("reports a file nothing imports", async () => {
    expect(await graph.findReferences("c.ts")).toMatchObject({
      known: true,
      importers: [],
      totalImporters: 0,
    });
  });

  it("does not know a path outside the index", async () => {
    expect(await graph.findReferences("nope.ts")).toMatchObject({
      known: false,
      totalImporters: 0,
    });
  });

  it("groups a symbol's references by file, capped both ways", async () => {
    const result = await graph.findReferences("a.ts", "greet");
    expect(result.known).toBe(true);
    expect(result.name).toBe("greet");
    expect(result.totalFiles).toBe(REFERENCE_FILES);
    expect(result.totalReferences).toBe(REFERENCE_FILES * LINES_PER_FILE);
    expect(result.references).toHaveLength(MAX_REFERENCES / LINES_PER_FILE);
    expect(
      result.references.reduce((total, group) => total + group.lines.length, 0),
    ).toBe(MAX_REFERENCES);
    expect(result.references.map((group) => group.file)).toEqual(
      [...result.references.map((group) => group.file)].sort(),
    );
    expect(result.references[0]).toEqual({ file: "g0.ts", lines: [1, 2, 3, 4, 5] });
  });

  it("orders a file's lines and counts every one", async () => {
    const result = await graph.findReferences("a.ts", "Greeter");
    expect(result.references).toEqual([{ file: "b.ts", lines: [4, 9] }]);
    expect(result.totalReferences).toBe(2);
    expect(result.totalFiles).toBe(1);
  });

  it("does not know a symbol the file does not define", async () => {
    expect(await graph.findReferences("a.ts", "nope")).toMatchObject({
      known: false,
      references: [],
      totalReferences: 0,
      totalFiles: 0,
    });
  });
});

describe("status", () => {
  it("merges Layer B coverage with every language Layer A saw", async () => {
    expect((await graph.status()).languages).toEqual([
      { language: "javascript", files: 0, indexed: true, resolutionRate: 0 },
      { language: "json", files: 1, indexed: false, resolutionRate: 0 },
      { language: "markdown", files: 1, indexed: false, resolutionRate: 0 },
      { language: "typescript", files: 3, indexed: true, resolutionRate: 0.5 },
    ]);
  });

  it("has no Layer B languages when no indexer ran", async () => {
    expect((await index.status()).languages.every((language) => !language.indexed)).toBe(
      true,
    );
  });
});
