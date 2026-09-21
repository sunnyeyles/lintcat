import { describe, expect, it } from "vitest";

import { navigate, navigationCandidates } from "./navigation";
import { normaliseGraph } from "./normalise";

const graph = normaliseGraph({
  files: [
    { path: "src/a.ts" },
    { path: "src/b.ts" },
    { path: "src/c.ts" },
    { path: "other/z.ts" },
    { path: "lone/only.ts" },
  ],
  imports: [
    { from: "src/a.ts", to: "src/b.ts" },
    { from: "src/a.ts", to: "other/z.ts" },
    { from: "src/c.ts", to: "src/a.ts" },
    { from: "other/z.ts", to: "src/a.ts" },
  ],
});

describe("navigate", () => {
  it("steps along dependencies in path order", () => {
    expect(navigationCandidates(graph, "src/a.ts", "dependencies")).toEqual([
      "other/z.ts",
      "src/b.ts",
    ]);
    expect(navigate(graph, "src/a.ts", "dependencies", "next")).toBe("other/z.ts");
    expect(navigate(graph, "src/a.ts", "dependencies", "previous")).toBe("src/b.ts");
  });

  it("steps along dependents", () => {
    expect(navigate(graph, "src/a.ts", "dependents", "next")).toBe("other/z.ts");
    expect(navigate(graph, "src/a.ts", "dependents", "previous")).toBe("src/c.ts");
  });

  it("cycles through siblings in the same group", () => {
    expect(navigate(graph, "src/a.ts", "siblings", "next")).toBe("src/b.ts");
    expect(navigate(graph, "src/b.ts", "siblings", "next")).toBe("src/c.ts");
    expect(navigate(graph, "src/c.ts", "siblings", "next")).toBe("src/a.ts");
    expect(navigate(graph, "src/a.ts", "siblings", "previous")).toBe("src/c.ts");
  });

  it("never leaves the group when moving between siblings", () => {
    expect(navigationCandidates(graph, "src/a.ts", "siblings")).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("keeps packages apart when the directory repeats", () => {
    const twoPackages = normaliseGraph({
      files: [
        { path: "src/a.ts", package: "one" },
        { path: "src/b.ts", package: "two" },
      ],
      imports: [],
    });

    expect(navigate(twoPackages, "src/a.ts", "siblings", "next")).toBeNull();
  });

  it("defaults to the next step", () => {
    expect(navigate(graph, "src/a.ts", "siblings")).toBe("src/b.ts");
  });

  it("returns null when there is nowhere to go", () => {
    expect(navigate(graph, "src/b.ts", "dependencies", "next")).toBeNull();
    expect(navigate(graph, "src/c.ts", "dependents", "next")).toBeNull();
    expect(navigate(graph, "lone/only.ts", "siblings", "next")).toBeNull();
    expect(navigate(graph, null, "dependencies", "next")).toBeNull();
    expect(navigate(graph, "ghost.ts", "dependencies", "next")).toBeNull();
  });
});
