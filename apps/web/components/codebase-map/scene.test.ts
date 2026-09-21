import { describe, expect, it } from "vitest";

import { buildScene } from "@/components/codebase-map/scene";
import { initialBounds } from "@/components/codebase-map/view";
import { EMPHASIS_MARKERS, groupIdFor, normaliseGraph } from "@/lib/codebase-map";
import type { MapGraph, MapViewState } from "@/lib/codebase-map";

const GRAPH: MapGraph = {
  files: [
    { path: "pkg/a/one.ts", package: "pkg", changed: true },
    { path: "pkg/a/two.ts", package: "pkg" },
    { path: "pkg/b/three.ts", package: "pkg" },
    { path: "pkg/b/four.ts", package: "pkg" },
  ],
  imports: [
    { from: "pkg/a/one.ts", to: "pkg/b/three.ts" },
    { from: "pkg/b/four.ts", to: "pkg/a/one.ts" },
  ],
};

const graph = normaliseGraph(GRAPH);

function view(overrides: Partial<MapViewState> = {}): MapViewState {
  return { focusedPath: null, query: "", expandedGroups: new Set(), ...overrides };
}

describe("buildScene", () => {
  it("draws a collapsed group as one node and an expanded one as its files", () => {
    const scene = buildScene(graph, view());
    const ids = scene.nodes.map((node) => node.id).sort();

    // pkg/a holds the changed file, so clustering keeps it open; pkg/b stays shut.
    expect(ids).toEqual(["pkg::pkg/b", "pkg/a/one.ts", "pkg/a/two.ts"].sort());
    expect(scene.byId.get("pkg::pkg/b")?.kind).toBe("group");
    expect(scene.byId.get("pkg::pkg/b")?.fileCount).toBe(2);
  });

  it("gives every file a visible representative", () => {
    const scene = buildScene(graph, view());
    for (const file of graph.files) {
      const id = scene.representativeOf.get(file.path);
      expect(id).toBeDefined();
      expect(scene.byId.has(id!)).toBe(true);
    }
    expect(scene.representativeOf.get("pkg/b/three.ts")).toBe("pkg::pkg/b");
  });

  it("expands a group the view asks for", () => {
    const scene = buildScene(graph, view({ expandedGroups: new Set(["pkg::pkg/b"]) }));
    expect(scene.byId.has("pkg/b/three.ts")).toBe(true);
    expect(scene.byId.has("pkg::pkg/b")).toBe(false);
  });

  it("splits edges by direction around the focus", () => {
    const expandedGroups = new Set(graph.files.map(groupIdFor));
    const scene = buildScene(graph, view({ focusedPath: "pkg/a/one.ts", expandedGroups }));
    const relations = Object.fromEntries(scene.edges.map((edge) => [`${edge.a}->${edge.b}`, edge.relation]));

    expect(relations["pkg/a/one.ts->pkg/b/three.ts"]).toBe("dependency");
    expect(relations["pkg/b/four.ts->pkg/a/one.ts"]).toBe("dependent");
  });

  it("takes its markers from the emphasis module", () => {
    const expandedGroups = new Set(graph.files.map(groupIdFor));
    const scene = buildScene(graph, view({ focusedPath: "pkg/b/three.ts", expandedGroups }));

    expect(scene.byId.get("pkg/b/three.ts")?.marker).toBe(EMPHASIS_MARKERS.focus);
    expect(scene.byId.get("pkg/a/one.ts")?.marker).toBe(EMPHASIS_MARKERS.changed);
    expect(scene.byId.get("pkg/a/one.ts")?.direction).toBe("dependent");
  });

  it("puts a node in the same place every time", () => {
    const first = buildScene(graph, view());
    const second = buildScene(graph, view());
    for (const node of first.nodes) {
      const other = second.byId.get(node.id)!;
      expect([other.x, other.y]).toEqual([node.x, node.y]);
    }
  });

  it("carries finding heat onto files and sums it onto a collapsed group", () => {
    const heat = {
      "pkg/a/one.ts": { total: 1, high: 0, medium: 0, low: 1 },
      "pkg/b/three.ts": { total: 2, high: 1, medium: 1, low: 0 },
      "pkg/b/four.ts": { total: 1, high: 0, medium: 0, low: 1 },
    };
    const scene = buildScene(graph, view(), 1, heat);

    expect(scene.byId.get("pkg/a/one.ts")?.heat.top).toBe("low");
    expect(scene.byId.get("pkg/a/two.ts")?.heat.top).toBeNull();
    expect(scene.byId.get("pkg::pkg/b")?.heat.counts).toEqual({
      total: 3,
      high: 1,
      medium: 1,
      low: 1,
    });
  });

  it("leaves every node cool when no heat is given", () => {
    expect(buildScene(graph, view()).nodes.every((n) => n.heat.band === 0)).toBe(true);
  });
});

describe("initialBounds", () => {
  it("fits the changed files and their neighbours, not the whole map", () => {
    const expandedGroups = new Set(graph.files.map(groupIdFor));
    const scene = buildScene(graph, view({ expandedGroups }));
    const bounds = initialBounds(scene, graph, ["pkg/a/one.ts"]);

    // one.ts plus three.ts and four.ts; two.ts imports nothing and is left out.
    const inside = (path: string) => {
      const node = scene.byId.get(path)!;
      return (
        node.x >= bounds.minX && node.x <= bounds.maxX && node.y >= bounds.minY && node.y <= bounds.maxY
      );
    };
    expect(inside("pkg/a/one.ts")).toBe(true);
    expect(inside("pkg/b/three.ts")).toBe(true);
    expect(inside("pkg/b/four.ts")).toBe(true);
    expect(bounds).not.toEqual(scene.bounds);
  });

  it("uses the collapsed group standing in for a changed file", () => {
    const scene = buildScene(graph, view());
    const bounds = initialBounds(scene, graph, ["pkg/b/three.ts"]);
    const group = scene.byId.get("pkg::pkg/b")!;

    expect(bounds.minX).toBeLessThanOrEqual(group.x);
    expect(bounds.maxX).toBeGreaterThanOrEqual(group.x);
  });

  it("falls back to the whole scene when nothing changed is in the graph", () => {
    const scene = buildScene(graph, view());

    expect(initialBounds(scene, graph, [])).toEqual(scene.bounds);
    expect(initialBounds(scene, graph, ["ghost.ts"])).toEqual(scene.bounds);
  });
});
