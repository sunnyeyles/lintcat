import { describe, expect, it } from "vitest";

import { normaliseGraph } from "./normalise";

describe("normaliseGraph", () => {
  it("keeps files once and sorts them by path", () => {
    const graph = normaliseGraph({
      files: [{ path: "b.ts" }, { path: "a.ts" }, { path: "b.ts" }],
      imports: [],
    });

    expect(graph.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(graph.dropped.duplicateFiles).toBe(1);
  });

  it("lets a duplicate fill in only what the first left unknown", () => {
    const graph = normaliseGraph({
      files: [
        { path: "a.ts", changed: false },
        { path: "a.ts", changed: true, dead: true, role: "lib" },
      ],
      imports: [],
    });

    expect(graph.byPath.get("a.ts")).toEqual({
      path: "a.ts",
      changed: false,
      dead: true,
      role: "lib",
    });
  });

  it("tolerates missing flags without inventing them", () => {
    const graph = normaliseGraph({ files: [{ path: "a.ts" }], imports: [] });

    const file = graph.byPath.get("a.ts");
    expect(file).toEqual({ path: "a.ts" });
    expect("changed" in file!).toBe(false);
    expect("dead" in file!).toBe(false);
    expect("inCycle" in file!).toBe(false);
  });

  it("drops imports to unknown files and to self", () => {
    const graph = normaliseGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }],
      imports: [
        { from: "a.ts", to: "b.ts" },
        { from: "a.ts", to: "a.ts" },
        { from: "a.ts", to: "ghost.ts" },
        { from: "ghost.ts", to: "b.ts" },
      ],
    });

    expect(graph.imports).toEqual([{ from: "a.ts", to: "b.ts" }]);
    expect(graph.dropped.selfImports).toBe(1);
    expect(graph.dropped.unresolvedImports).toBe(2);
  });

  it("drops repeated imports", () => {
    const graph = normaliseGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }],
      imports: [
        { from: "a.ts", to: "b.ts" },
        { from: "a.ts", to: "b.ts" },
      ],
    });

    expect(graph.imports).toHaveLength(1);
    expect(graph.dropped.duplicateImports).toBe(1);
  });

  it("drops files without a usable path and trims the rest", () => {
    const graph = normaliseGraph({
      files: [{ path: "  a.ts  " }, { path: "   " }],
      imports: [{ from: " a.ts ", to: "a.ts" }],
    });

    expect(graph.files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(graph.dropped.invalidFiles).toBe(1);
    expect(graph.dropped.selfImports).toBe(1);
  });

  it("indexes both directions in sorted order", () => {
    const graph = normaliseGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }],
      imports: [
        { from: "c.ts", to: "a.ts" },
        { from: "b.ts", to: "a.ts" },
        { from: "a.ts", to: "b.ts" },
      ],
    });

    expect(graph.outgoing.get("a.ts")).toEqual(["b.ts"]);
    expect(graph.incoming.get("a.ts")).toEqual(["b.ts", "c.ts"]);
    expect(graph.outgoing.get("c.ts")).toEqual(["a.ts"]);
  });

  it("carries the truncated flag through as a boolean", () => {
    expect(normaliseGraph({ files: [], imports: [] }).truncated).toBe(false);
    expect(normaliseGraph({ files: [], imports: [], truncated: true }).truncated).toBe(true);
  });
});
