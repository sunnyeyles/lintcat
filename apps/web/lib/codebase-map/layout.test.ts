import { describe, expect, it } from "vitest";

import { filePosition, groupLayout, layoutGroups, seedPosition } from "./layout";
import { normaliseGraph } from "./normalise";

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

describe("groupLayout", () => {
  const ids = ["web::app", "web::lib", "db::src", "ui::components", "docs::guides", "api::routes"];
  const coupled = [
    { from: "web::app", to: "web::lib", count: 40 },
    { from: "web::lib", to: "web::app", count: 5 },
    { from: "api::routes", to: "db::src", count: 30 },
  ];
  const gap = (layout: Record<string, { x: number; y: number }>, a: string, b: string) =>
    Math.hypot(layout[a]!.x - layout[b]!.x, layout[a]!.y - layout[b]!.y);

  it("gives the same positions for the same input, whatever its order", () => {
    const first = groupLayout(ids, coupled);
    const second = groupLayout([...ids].reverse(), [...coupled].reverse());

    expect(second).toEqual(first);
    expect(Object.keys(first).sort()).toEqual([...ids].sort());
  });

  it("puts coupled groups closer together than uncoupled ones", () => {
    const layout = groupLayout(ids, coupled);

    expect(gap(layout, "web::app", "web::lib")).toBeLessThan(gap(layout, "web::app", "docs::guides"));
    expect(gap(layout, "api::routes", "db::src")).toBeLessThan(gap(layout, "api::routes", "ui::components"));
  });

  it("keeps every group on the map disc", () => {
    const layout = groupLayout(ids, coupled, { mapRadius: 500 });
    for (const point of Object.values(layout)) {
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(1000.01);
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  it("lays out summaries too, from the group counts the payload carries", () => {
    const summarised = normaliseGraph({
      files: [{ path: "src/a.ts", package: "web" }],
      imports: [],
      summaries: [{ id: "db::other", fileCount: 30, changedCount: 0 }],
      groupImports: [{ from: "web::src", to: "db::other", count: 3 }],
    });

    expect(Object.keys(layoutGroups(summarised)).sort()).toEqual(["db::other", "web::src"]);
  });

  it("is empty for no groups and centred for one", () => {
    expect(groupLayout([], [])).toEqual({});
    expect(groupLayout(["web::src"], [])).toEqual({ "web::src": { x: 0, y: 0 } });
  });
});

describe("filePosition", () => {
  it("keeps a file on its group's disc", () => {
    const point = filePosition("src/a.ts", { x: 100, y: -50 }, 20);

    expect(Math.hypot(point.x - 100, point.y + 50)).toBeLessThanOrEqual(20.01);
    expect(filePosition("src/a.ts", { x: 100, y: -50 }, 20)).toEqual(point);
  });
});
