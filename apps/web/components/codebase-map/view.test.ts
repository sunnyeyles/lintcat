import { describe, expect, it } from "vitest";

import { initialBounds } from "@/components/codebase-map/view";
import { buildScene, groupIdFor, normaliseGraph } from "@/lib/codebase-map";
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
