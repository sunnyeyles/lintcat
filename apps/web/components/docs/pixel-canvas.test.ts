import { describe, expect, it } from "vitest";

import { edges, paint, replay, type Painter } from "./pixel-canvas";

const G = 384, H = 216;
const PALETTE = ["paper", "ink", "teal"];

function record(grid: Uint8Array, width: number, height: number) {
  const rects: { x: number; y: number; w: number; h: number; colour: string }[] = [];
  const ctx: Painter = { fillStyle: "", fillRect: (x, y, w, h) => rects.push({ x, y, w, h, colour: String(ctx.fillStyle) }) };
  paint(ctx, grid, G, H, PALETTE, width, height);
  return rects;
}

describe("edges", () => {
  it("spans the canvas in whole pixels, each cell within one pixel of the rest", () => {
    const xs = edges(G, 1170);
    expect(xs[0]).toBe(0);
    expect(xs[G]).toBe(1170);
    const widths = xs.slice(1).map((x, i) => x - xs[i]);
    expect(widths.every(Number.isInteger)).toBe(true);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });
});

describe("paint", () => {
  it.each([
    [1440, 810],
    [1170, 658],
    [384, 216],
  ])("covers a %ix%i canvas exactly once, in palette colours only", (width, height) => {
    const grid = new Uint8Array(G * H);
    replay(grid, [5 * 16 + 1, (G * 100 + 200) * 16 + 2, (G * H - 1) * 16 + 1], 0, 3);
    const hits = new Uint8Array(width * height);
    for (const r of record(grid, width, height)) {
      expect(PALETTE).toContain(r.colour);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) hits[y * width + x]++;
    }
    expect(hits.every((n) => n === 1)).toBe(true);
  });

  it("paints each laid cell in its own colour", () => {
    const grid = new Uint8Array(G * H);
    replay(grid, [(G * 10 + 20) * 16 + 2], 0, 1);
    const rects = record(grid, G, H);
    expect(rects).toContainEqual({ x: 20, y: 10, w: 1, h: 1, colour: "teal" });
  });
});
