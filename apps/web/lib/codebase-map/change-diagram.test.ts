import { describe, expect, it } from "vitest";

import { changeDiagram, type ChangeDiagram } from "./change-diagram";
import type { MapGraph } from "./types";

const graph: MapGraph = {
  files: [
    { path: "packages/reviewer/src/agent.ts", package: "reviewer", changed: true },
    { path: "packages/reviewer/src/tools.ts", package: "reviewer", changed: true },
    { path: "packages/reviewer/src/validate.ts", package: "reviewer", changed: false },
    { path: "packages/index/src/symbols.ts", package: "index", changed: true },
    { path: "packages/index/src/graph.ts", package: "index", changed: false },
    { path: "packages/github/src/client.ts", package: "github", changed: false },
    { path: "apps/web/app/webhook.ts", package: "web", changed: false },
    { path: "apps/web/app/page.tsx", package: "web", changed: false },
  ],
  imports: [
    { from: "apps/web/app/webhook.ts", to: "packages/reviewer/src/agent.ts" },
    { from: "packages/reviewer/src/agent.ts", to: "packages/reviewer/src/tools.ts" },
    { from: "packages/reviewer/src/agent.ts", to: "packages/reviewer/src/validate.ts" },
    { from: "packages/reviewer/src/tools.ts", to: "packages/index/src/graph.ts" },
    { from: "packages/reviewer/src/tools.ts", to: "packages/index/src/symbols.ts" },
    { from: "packages/index/src/symbols.ts", to: "packages/index/src/graph.ts" },
    { from: "apps/web/app/webhook.ts", to: "packages/github/src/client.ts" },
    { from: "apps/web/app/page.tsx", to: "apps/web/app/webhook.ts" },
  ],
};

const heat = { "packages/reviewer/src/tools.ts": { total: 2, high: 1, medium: 1, low: 0 } };

const ids = (diagram: ChangeDiagram) => diagram.nodes.map((node) => node.id).sort();

function overlaps(a: ChangeDiagram["boxes"][number], b: ChangeDiagram["boxes"][number]) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("changeDiagram", () => {
  it("draws changed files and their one-hop neighbours only", () => {
    const diagram = changeDiagram({ graph, changedFiles: [], heat });
    expect(ids(diagram)).toEqual([
      "apps/web/app/webhook.ts",
      "packages/index/src/graph.ts",
      "packages/index/src/symbols.ts",
      "packages/reviewer/src/agent.ts",
      "packages/reviewer/src/tools.ts",
      "packages/reviewer/src/validate.ts",
    ]);
    expect(diagram.changedCount).toBe(3);
    expect(diagram.neighbourCount).toBe(3);
  });

  it("keeps only edges between drawn nodes and heats those touching a change", () => {
    const diagram = changeDiagram({ graph, changedFiles: [], heat });
    const drawn = new Set(ids(diagram));
    for (const edge of diagram.edges) {
      expect(drawn.has(edge.from) && drawn.has(edge.to)).toBe(true);
    }
    const cold = diagram.edges.filter((edge) => !edge.hot);
    expect(cold).toEqual([]);
    expect(diagram.edges).toHaveLength(6);
  });

  it("picks changed files with findings first and ranks neighbours by links", () => {
    const diagram = changeDiagram({ graph, changedFiles: [], heat }, { maxNodes: 2, maxChanged: 1 });
    expect(ids(diagram)).toEqual(["packages/index/src/graph.ts", "packages/reviewer/src/tools.ts"]);
    expect(diagram.hiddenChanged).toBe(2);
    expect(diagram.nodes.find((node) => node.id.endsWith("tools.ts"))?.pulse).toBe(true);
  });

  it("does not bring a capped-out changed file back as a neighbour", () => {
    const diagram = changeDiagram({ graph, changedFiles: [], heat }, { maxChanged: 1 });
    expect(ids(diagram)).not.toContain("packages/reviewer/src/agent.ts");
    expect(ids(diagram)).not.toContain("packages/index/src/symbols.ts");
  });

  it("lays boxes out without overlap and every node inside its box", () => {
    const diagram = changeDiagram({ graph, changedFiles: [], heat });
    diagram.boxes.forEach((a, i) =>
      diagram.boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)),
    );
    for (const node of diagram.nodes) {
      const inside = diagram.boxes.some(
        (box) =>
          node.x > box.x && node.x < box.x + box.w && node.y > box.y && node.y + 22 < box.y + box.h,
      );
      expect(inside, node.id).toBe(true);
    }
    for (const box of diagram.boxes) {
      expect(box.x + box.w).toBeLessThanOrEqual(diagram.width);
      expect(box.y + box.h).toBeLessThanOrEqual(diagram.height);
    }
  });

  it("is deterministic", () => {
    const input = { graph, changedFiles: [], heat };
    expect(changeDiagram(input)).toEqual(changeDiagram(input));
  });

  it("falls back to changed files grouped by directory when there is no graph", () => {
    const diagram = changeDiagram({
      graph: undefined,
      heat: {},
      changedFiles: [
        { path: "apps/web/app/page.tsx", status: "modified", additions: 1, deletions: 0 },
        { path: "apps/web/lib/new.ts", status: "added", additions: 4, deletions: 0 },
        { path: "packages/db/src/old.ts", status: "removed", additions: 0, deletions: 9 },
        { path: "README.md", status: "modified", additions: 1, deletions: 1 },
      ],
    });
    expect(diagram.edges).toEqual([]);
    expect(ids(diagram)).toEqual(["README.md", "apps/web/app/page.tsx", "apps/web/lib/new.ts"]);
    expect(diagram.boxes.map((box) => box.label).sort()).toEqual([".", "apps/web"]);
    expect(diagram.nodes.every((node) => node.changed)).toBe(true);
  });

  it("draws a file the PR adds without edges", () => {
    const withAdded: MapGraph = {
      ...graph,
      files: [...graph.files, { path: "packages/index/src/batch.ts", package: "index", changed: true }],
    };
    const diagram = changeDiagram({ graph: withAdded, changedFiles: [], heat });
    expect(ids(diagram)).toContain("packages/index/src/batch.ts");
    expect(diagram.edges.some((e) => e.from.endsWith("batch.ts") || e.to.endsWith("batch.ts"))).toBe(
      false,
    );
  });
});
