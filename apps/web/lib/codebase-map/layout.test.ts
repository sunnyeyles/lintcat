import { describe, expect, it } from "vitest";

import { seedLayout, seedPosition } from "./layout";
import { normaliseGraph } from "./normalise";

const graph = normaliseGraph({
  files: [
    { path: "src/a.ts", package: "web" },
    { path: "src/b.ts", package: "web" },
    { path: "other/c.ts", package: "db" },
  ],
  imports: [],
});

describe("seedPosition", () => {
  it("returns the same point for the same path and group", () => {
    expect(seedPosition("src/a.ts", "web::src")).toEqual(seedPosition("src/a.ts", "web::src"));
  });

  it("moves a file when its group changes", () => {
    expect(seedPosition("src/a.ts", "web::src")).not.toEqual(seedPosition("src/a.ts", "db::src"));
  });

  it("separates two files in one group", () => {
    expect(seedPosition("src/a.ts", "web::src")).not.toEqual(seedPosition("src/b.ts", "web::src"));
  });

  it("keeps a file inside its group's disc", () => {
    const centre = seedPosition("", "web::src", { groupRadius: 0 });
    const point = seedPosition("src/a.ts", "web::src", { groupRadius: 50 });
    const distance = Math.hypot(point.x - centre.x, point.y - centre.y);

    expect(distance).toBeLessThanOrEqual(50.01);
  });

  it("scales with the map radius", () => {
    const near = seedPosition("src/a.ts", "web::src", { mapRadius: 10, groupRadius: 0 });

    expect(Math.hypot(near.x, near.y)).toBeLessThanOrEqual(10.01);
  });

  it("rounds to two decimals", () => {
    const { x, y } = seedPosition("src/a.ts", "web::src");

    expect(x).toBe(Math.round(x * 100) / 100);
    expect(y).toBe(Math.round(y * 100) / 100);
  });
});

describe("seedLayout", () => {
  it("places every file", () => {
    const layout = seedLayout(graph);

    expect([...layout.keys()].sort()).toEqual(["other/c.ts", "src/a.ts", "src/b.ts"]);
    expect([...layout.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
      true,
    );
  });

  it("is identical between runs and independent of input order", () => {
    const reversed = normaliseGraph({
      files: [
        { path: "other/c.ts", package: "db" },
        { path: "src/b.ts", package: "web" },
        { path: "src/a.ts", package: "web" },
      ],
      imports: [],
    });

    expect([...seedLayout(graph)]).toEqual([...seedLayout(reversed)]);
  });

  it("keeps files of one group closer together than files of different groups", () => {
    const layout = seedLayout(graph);
    const gap = (a: string, b: string) => {
      const one = layout.get(a)!;
      const two = layout.get(b)!;
      return Math.hypot(one.x - two.x, one.y - two.y);
    };

    expect(gap("src/a.ts", "src/b.ts")).toBeLessThan(gap("src/a.ts", "other/c.ts"));
  });
});
