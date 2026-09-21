import { describe, expect, it } from "vitest";

import { neighbourhood, neighbourhoodOf } from "./neighbourhood";
import { normaliseGraph } from "./normalise";

const chain = normaliseGraph({
  files: [
    { path: "a.ts" },
    { path: "b.ts" },
    { path: "c.ts" },
    { path: "d.ts" },
    { path: "loose.ts" },
  ],
  imports: [
    { from: "a.ts", to: "b.ts" },
    { from: "b.ts", to: "c.ts" },
    { from: "d.ts", to: "b.ts" },
  ],
});

describe("neighbourhood", () => {
  it("separates what a file depends on from what depends on it", () => {
    const hood = neighbourhood(chain, "b.ts", 1);

    expect([...hood.dependencies.keys()]).toEqual(["c.ts"]);
    expect([...hood.dependents.keys()]).toEqual(["a.ts", "d.ts"]);
  });

  it("reaches further with more steps and records the depth", () => {
    const one = neighbourhood(chain, "a.ts", 1);
    const two = neighbourhood(chain, "a.ts", 2);

    expect([...one.dependencies.entries()]).toEqual([["b.ts", 1]]);
    expect([...two.dependencies.entries()]).toEqual([
      ["b.ts", 1],
      ["c.ts", 2],
    ]);
  });

  it("never reaches an unconnected file", () => {
    const hood = neighbourhood(chain, "a.ts", 10);

    expect(hood.neighbours.map((n) => n.path)).not.toContain("loose.ts");
  });

  it("marks a file reachable both ways as both", () => {
    const cycle = normaliseGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }],
      imports: [
        { from: "a.ts", to: "b.ts" },
        { from: "b.ts", to: "a.ts" },
      ],
    });

    expect(neighbourhood(cycle, "a.ts", 1).neighbours).toEqual([
      { path: "b.ts", depth: 1, direction: "both" },
    ]);
  });

  it("sorts neighbours by depth then path", () => {
    const hood = neighbourhood(chain, "b.ts", 2);

    expect(hood.neighbours.map((n) => [n.path, n.depth, n.direction])).toEqual([
      ["a.ts", 1, "dependent"],
      ["c.ts", 1, "dependency"],
      ["d.ts", 1, "dependent"],
    ]);
  });

  it("excludes the focus itself", () => {
    const cycle = normaliseGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }],
      imports: [
        { from: "a.ts", to: "b.ts" },
        { from: "b.ts", to: "a.ts" },
      ],
    });

    expect(cycle.byPath.has("a.ts")).toBe(true);
    expect(neighbourhood(cycle, "a.ts", 5).dependencies.has("a.ts")).toBe(false);
  });

  it("returns nothing for no focus, an unknown focus or no steps", () => {
    expect(neighbourhood(chain, null).neighbours).toEqual([]);
    expect(neighbourhood(chain, "ghost.ts").neighbours).toEqual([]);
    expect(neighbourhood(chain, "a.ts", 0).neighbours).toEqual([]);
  });
});

describe("neighbourhoodOf", () => {
  it("unions several focuses and their one-step reach, both directions", () => {
    expect([...neighbourhoodOf(chain, ["a.ts"], 1)].sort()).toEqual(["a.ts", "b.ts"]);
    expect([...neighbourhoodOf(chain, ["c.ts"], 1)].sort()).toEqual(["b.ts", "c.ts"]);
    expect([...neighbourhoodOf(chain, ["a.ts", "c.ts"], 1)].sort()).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
  });

  it("reaches further with more steps", () => {
    expect([...neighbourhoodOf(chain, ["a.ts"], 2)].sort()).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
    ]);
  });

  it("drops a focus the graph does not have, and keeps a lone file alone", () => {
    expect([...neighbourhoodOf(chain, ["missing.ts", "loose.ts"], 1)]).toEqual(["loose.ts"]);
  });

  it("is empty without focuses", () => {
    expect(neighbourhoodOf(chain, [], 1).size).toBe(0);
  });
});
