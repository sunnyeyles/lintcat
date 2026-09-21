import { describe, expect, it } from "vitest";

import { buildScene } from "@/components/codebase-map/scene";
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
});
