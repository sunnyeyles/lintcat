import { describe, expect, it } from "vitest";

import {
  clusterGraph,
  emphasise,
  mapStatus,
  navigate,
  neighbourhood,
  normaliseGraph,
  sampleRepo,
  searchFiles,
  seedLayout,
} from "./index";
import type { MapViewState } from "./index";

describe("codebase-map barrel", () => {
  it("drives a whole view from sample data", () => {
    const graph = normaliseGraph(sampleRepo(11, 120));
    const focusedPath = graph.files[0]!.path;
    const view: MapViewState = { focusedPath, query: "", expandedGroups: new Set() };

    expect(mapStatus(graph).kind).toBe("ready");
    expect(clusterGraph(graph, view).groups.length).toBeGreaterThan(0);
    expect(emphasise(graph, view).get(focusedPath)?.level).toBe("focus");
    expect(seedLayout(graph).size).toBe(120);
    expect(neighbourhood(graph, focusedPath, 2).focus).toBe(focusedPath);
    expect(searchFiles(graph.files, "review").length).toBeGreaterThan(0);
    expect(navigate(graph, focusedPath, "siblings")).not.toBe(focusedPath);
  });
});
