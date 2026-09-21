import { describe, expect, it } from "vitest";

import {
  classify,
  classifyEdges,
  clusterOf,
  DEFAULT_VIEW,
  layout,
  type MapGraph,
  neighbours,
  stats,
} from "./codebase-map";

const graph: MapGraph = {
  nodes: [
    { id: "apps/web/app/page.tsx", kind: "source", size: 3, changed: true },
    { id: "apps/web/lib/docs.ts", kind: "source", size: 2 },
    { id: "apps/web/lib/docs.test.ts", kind: "test", size: 1 },
    { id: "packages/design/src/theme.css", kind: "config", size: 4, changed: true },
    { id: "packages/ai/src/agent.ts", kind: "source", size: 5, cycle: true },
    { id: "packages/ai/src/tools.ts", kind: "source", size: 2, cycle: true },
    { id: "packages/index/src/legacy.ts", kind: "source", size: 1, dead: true },
    { id: "README.md", kind: "docs", size: 1 },
  ],
  edges: [
    { from: "apps/web/app/page.tsx", to: "apps/web/lib/docs.ts" },
    { from: "apps/web/lib/docs.test.ts", to: "apps/web/lib/docs.ts" },
    { from: "apps/web/app/page.tsx", to: "packages/design/src/theme.css" },
    { from: "packages/ai/src/agent.ts", to: "packages/ai/src/tools.ts" },
    { from: "packages/ai/src/tools.ts", to: "packages/ai/src/agent.ts" },
  ],
};

describe("classify", () => {
  it("emphasises changed files and dims the rest by default", () => {
    const states = classify(graph, DEFAULT_VIEW);
    expect(states.get("apps/web/app/page.tsx")).toBe("emphasis");
    expect(states.get("packages/design/src/theme.css")).toBe("emphasis");
    expect(states.get("apps/web/lib/docs.ts")).toBe("dim");
  });

  it("shows everything at rest when nothing is highlighted", () => {
    const states = classify(graph, { ...DEFAULT_VIEW, highlight: "none" });
    expect(new Set(states.values())).toEqual(new Set(["normal"]));
  });

  it("focus wins: the focused file, then its neighbourhood, then everything dimmed", () => {
    const states = classify(graph, { ...DEFAULT_VIEW, focus: "apps/web/lib/docs.ts" });
    expect(states.get("apps/web/lib/docs.ts")).toBe("focus");
    expect(states.get("apps/web/app/page.tsx")).toBe("emphasis");
    expect(states.get("apps/web/lib/docs.test.ts")).toBe("emphasis");
    expect(states.get("packages/design/src/theme.css")).toBe("dim");
  });

  it("dependencies mode shows only what the focused file imports", () => {
    const view = { ...DEFAULT_VIEW, focus: "apps/web/app/page.tsx", highlight: "dependencies" as const };
    const states = classify(graph, view);
    expect(states.get("apps/web/lib/docs.ts")).toBe("emphasis");
    expect(states.get("apps/web/lib/docs.test.ts")).toBe("dim");
  });

  it("hides files whose kind is filtered out", () => {
    const states = classify(graph, { ...DEFAULT_VIEW, kinds: new Set(["source"]) });
    expect(states.get("apps/web/lib/docs.test.ts")).toBe("hidden");
    expect(states.get("README.md")).toBe("hidden");
    expect(states.get("apps/web/lib/docs.ts")).toBe("dim");
  });

  it("hides dead files only when asked", () => {
    expect(classify(graph, DEFAULT_VIEW).get("packages/index/src/legacy.ts")).toBe("dim");
    expect(classify(graph, { ...DEFAULT_VIEW, showDead: false }).get("packages/index/src/legacy.ts")).toBe("hidden");
  });

  it("a search hides non-matching files, case-insensitively", () => {
    const states = classify(graph, { ...DEFAULT_VIEW, query: "DOCS" });
    expect(states.get("apps/web/lib/docs.ts")).toBe("dim");
    expect(states.get("apps/web/app/page.tsx")).toBe("hidden");
  });

  it("never breaks on a graph with no flags at all", () => {
    const bare: MapGraph = { nodes: [{ id: "a.ts", kind: "source", size: 1 }], edges: [] };
    expect(classify(bare, DEFAULT_VIEW).get("a.ts")).toBe("normal");
  });
});

describe("classifyEdges", () => {
  it("drops edges touching a hidden file and lifts edges on the focus", () => {
    const view = { ...DEFAULT_VIEW, focus: "apps/web/lib/docs.ts", kinds: new Set(["source" as const]) };
    const edges = classifyEdges(graph, classify(graph, view), view);
    expect(edges[0]).toBe("emphasis");
    expect(edges[1]).toBe("hidden");
    expect(edges[2]).toBe("hidden");
    expect(edges[3]).toBe("dim");
  });
});

describe("neighbours and stats", () => {
  it("separates imports from importers", () => {
    expect(neighbours(graph, "apps/web/lib/docs.ts")).toEqual({
      imports: [],
      importedBy: ["apps/web/app/page.tsx", "apps/web/lib/docs.test.ts"],
    });
  });

  it("counts flags without requiring them", () => {
    expect(stats(graph)).toEqual({ files: 8, changed: 2, edges: 5, cycles: 2, dead: 1 });
  });
});

describe("layout", () => {
  it("clusters by the first two path segments and keeps every node inside its cluster", () => {
    expect(clusterOf("apps/web/app/page.tsx")).toBe("apps/web");
    expect(clusterOf("README.md")).toBe("README.md");
    const { positions, clusters } = layout(graph, 800, 600);
    expect(positions.size).toBe(graph.nodes.length);
    for (const cluster of clusters) {
      for (const member of cluster.members) {
        const p = positions.get(member)!;
        expect(Math.hypot(p.x - cluster.centre.x, p.y - cluster.centre.y)).toBeLessThanOrEqual(cluster.radius);
      }
    }
  });

  it("is deterministic", () => {
    expect(layout(graph, 800, 600)).toEqual(layout(graph, 800, 600));
  });
});
