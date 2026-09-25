import { describe, expect, it } from "vitest";

import { clusterGraph } from "./clustering";
import { expandGroup, mergeGraphs } from "./merge";
import { normaliseGraph } from "./normalise";
import type { MapGraph, MapViewState } from "./types";

const SHUT: MapViewState = { focusedPath: null, query: "", expandedGroups: new Set() };

const base: MapGraph = {
  files: [
    { path: "src/a.ts", package: "web", changed: true },
    { path: "src/b.ts", package: "web" },
  ],
  imports: [{ from: "src/a.ts", to: "src/b.ts" }],
  summaries: [
    { id: "web::lib", fileCount: 2, changedCount: 0, heat: { total: 3, high: 1, medium: 0, low: 2 } },
    { id: "db::store", fileCount: 5, changedCount: 1 },
  ],
  groupImports: [{ from: "web::src", to: "web::lib", count: 4 }],
  totalFileCount: 9,
};

const slice: MapGraph = {
  files: [
    { path: "lib/one.ts", package: "web" },
    { path: "lib/two.ts", package: "web" },
  ],
  imports: [
    { from: "lib/one.ts", to: "lib/two.ts" },
    { from: "src/a.ts", to: "lib/one.ts" },
  ],
};

describe("mergeGraphs", () => {
  it("adds the arriving files and edges", () => {
    const merged = mergeGraphs(base, slice);

    expect(merged.files.map((f) => f.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "lib/one.ts",
      "lib/two.ts",
    ]);
    expect(merged.imports).toHaveLength(3);
  });

  it("changes nothing the second time", () => {
    const once = mergeGraphs(base, slice);
    expect(mergeGraphs(once, slice)).toEqual(once);
  });

  it("drops an edge it already has", () => {
    const merged = mergeGraphs(base, {
      files: [],
      imports: [{ from: "src/a.ts", to: "src/b.ts" }],
    });
    expect(merged.imports).toHaveLength(1);
  });

  it("keeps a flag the map already had rather than the arriving one", () => {
    const merged = mergeGraphs(base, {
      files: [{ path: "src/a.ts", changed: false, dead: true }],
      imports: [],
    });
    const file = merged.files.find((f) => f.path === "src/a.ts")!;

    expect(file.changed).toBe(true);
    expect(file.dead).toBe(true);
  });

  it("brings an arriving file's impacted flag in", () => {
    const merged = mergeGraphs(base, {
      files: [
        { path: "src/b.ts", impacted: true },
        { path: "lib/one.ts", package: "web", impacted: true },
      ],
      imports: [],
    });
    const impacted = normaliseGraph(merged).files.filter((f) => f.impacted === true);

    expect(impacted.map((f) => f.path)).toEqual(["lib/one.ts", "src/b.ts"]);
  });

  it("retires a summary once every one of its files is present", () => {
    const merged = mergeGraphs(base, slice);

    expect(merged.summaries!.map((s) => s.id)).toEqual(["db::store"]);
  });

  it("keeps a summary that is only partly filled", () => {
    const merged = mergeGraphs(base, {
      files: [{ path: "lib/one.ts", package: "web" }],
      imports: [],
    });
    expect(merged.summaries!.map((s) => s.id)).toContain("web::lib");
  });

  it("leaves a full payload without summaries alone", () => {
    const full: MapGraph = { files: [{ path: "a.ts" }], imports: [] };
    expect(mergeGraphs(full, { files: [{ path: "b.ts" }], imports: [] }).summaries).toBeUndefined();
  });
});

describe("expandGroup", () => {
  it("makes the group loaded and expandable", () => {
    const merged = expandGroup(base, "web::lib", slice);
    const { groups } = clusterGraph(normaliseGraph(merged), {
      ...SHUT,
      expandedGroups: new Set(["web::lib"]),
    });
    const group = groups.find((g) => g.id === "web::lib")!;

    expect(group.loaded).toBe(true);
    expect(group.collapsed).toBe(false);
    expect(group.files).toEqual(["lib/one.ts", "lib/two.ts"]);
  });

  it("retires the summary even when the count it carried was stale", () => {
    const stale: MapGraph = {
      ...base,
      summaries: [{ id: "web::lib", fileCount: 99, changedCount: 0 }],
    };
    expect(expandGroup(stale, "web::lib", slice).summaries).toEqual([]);
  });

  it("leaves every other summary standing", () => {
    expect(expandGroup(base, "web::lib", slice).summaries!.map((s) => s.id)).toEqual([
      "db::store",
    ]);
  });
});

describe("a merged graph", () => {
  it("still counts the repo's whole size", () => {
    const graph = normaliseGraph(expandGroup(base, "web::lib", slice));

    expect(graph.totalFileCount).toBe(9);
    expect(graph.summaries.map((s) => s.id)).toEqual(["db::store"]);
  });
});
