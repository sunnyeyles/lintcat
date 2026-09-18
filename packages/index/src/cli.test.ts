/** The JSON seam: an index printed by the CLI must load back unchanged. */
import { describe, expect, it } from "vitest";

import { buildLayerA } from "./build.js";
import { loadIndexData } from "./cli.js";
import type { FileSource, RepositoryIndexData } from "./types.js";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "tiny" }),
  "a.ts": "",
  "README.md": "",
};

const source: FileSource = {
  sha: "abc123",
  listPaths: () => Promise.resolve({ paths: Object.keys(FILES).sort(), truncated: false }),
  read: (path: string) => Promise.resolve(FILES[path]),
};

const data: RepositoryIndexData = {
  ...(await buildLayerA(source, new Date("2026-02-03T04:05:06.000Z"))),
  layerB: {
    symbols: [
      { id: 0, file: "a.ts", name: "greet", kind: "function", line: 1, endLine: 3, exported: true },
    ],
    references: [{ symbol: 0, file: "b.ts", line: 4 }],
    imports: [{ from: "b.ts", to: "a.ts" }],
    coverage: [{ language: "typescript", files: 1, indexed: true, resolutionRate: 1 }],
  },
};

describe("loadIndexData", () => {
  it("round-trips a built index", () => {
    expect(loadIndexData(JSON.stringify(data))).toEqual(data);
  });

  it("loads a Layer A index with no graph", () => {
    const { layerB: _layerB, ...layerA } = data;
    expect(loadIndexData(JSON.stringify(layerA)).layerB).toBeUndefined();
  });

  it("rejects anything that is not an index", () => {
    expect(() => loadIndexData("{}")).toThrow();
    expect(() => loadIndexData(JSON.stringify({ ...data, version: 2 }))).toThrow();
    expect(() =>
      loadIndexData(JSON.stringify({ ...data, files: [{ path: "a.ts" }] })),
    ).toThrow();
  });
});
