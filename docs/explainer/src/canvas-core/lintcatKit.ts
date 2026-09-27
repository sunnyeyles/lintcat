// LINTCAT KIT. Stages author in 192 x 108 design units; every mark lands on a grid K times finer.
// A stage authors passes into a PixelDraft; `drawingFilm` replays them, cel by cel, then holds.
import type { Env } from "./core";
import type { Film } from "./film";
import { blit, celPlan, PixelDraft } from "./pixelArtKit";

export const K = 2, G = 192 * K, H = 108 * K;
export const FPS = 30, BPM = 120, CEL = 3;

export const C = {
  paper: 0, shade: 1, rule: 2, ink: 3, mark: 4, half: 5, teal: 6, tealDeep: 7, tealTint: 8,
  coral: 9, coralDeep: 10, coralTint: 11, amber: 12, white: 13, lavender: 14, black: 15,
} as const;

// Paper is each mode's --bgColor-default in packages/design/src/brand.css; the page repaints it from CSS.
export const PALETTES = {
  light: [
    "#FAF6EE", "#E4DCC9", "#C9BFA8", "#1E2D42", "#1E2D42", "#8C96A8", "#3AA693", "#25776A",
    "#A8DCD1", "#F47B4E", "#BF4E28", "#F9C9B5", "#E9B23C", "#FFFFFF", "#B9B3DD", "#0E1826",
  ],
  dark: [
    "#0B1311", "#212928", "#3D4644", "#EEF8F6", "#1E2D42", "#909A98", "#3AA693", "#2F8C7D",
    "#1D5C5A", "#F47B4E", "#C4552C", "#6B2E1C", "#E9B23C", "#FFFFFF", "#4A4478", "#010504",
  ],
};

export type Pt = [number, number];

// ---------------------------------------------------------------- design units to fine cells
const k = (v: number) => Math.round(v * K);
// The middle of a design cell, so a 1-cell line runs through what used to be a 1-unit line.
const mid = (v: number) => v * K + (K - 1) / 2;

// ---------------------------------------------------------------- marks
export const fill = (d: PixelDraft, x: number, y: number, w: number, h: number, c: number) => { d.begin("fill"); d.rect(k(x), k(y), k(x + w) - k(x), k(y + h) - k(y), c); };
export const stroke = (d: PixelDraft, pts: Pt[], c: number) => { d.begin("pencil"); for (let i = 0; i + 1 < pts.length; i++) d.line(mid(pts[i][0]), mid(pts[i][1]), mid(pts[i + 1][0]), mid(pts[i + 1][1]), c); };
export const box = (d: PixelDraft, x: number, y: number, w: number, h: number, c: number, bg?: number) => {
  const x0 = k(x), y0 = k(y), x1 = k(x + w) - 1, y1 = k(y + h) - 1;
  if (bg !== undefined) { d.begin("fill"); d.rect(x0 + 1, y0 + 1, x1 - x0 - 1, y1 - y0 - 1, bg); }
  d.begin("pencil"); d.line(x0, y0, x1, y0, c); d.line(x1, y0, x1, y1, c); d.line(x1, y1, x0, y1, c); d.line(x0, y1, x0, y0, c);
};
export const dither = (d: PixelDraft, x: number, y: number, w: number, h: number, c: number, level = 2) => {
  d.begin("cluster");
  for (let j = k(y); j < k(y + h); j++) for (let i = k(x); i < k(x + w); i++) if (PixelDraft.dith(i, j, level)) d.px(i, j, c);
};
// An arrow: the shaft as one pencil line, the head as two short strokes at the tip.
export const arrow = (d: PixelDraft, a: Pt, b: Pt, c: number) => {
  const [ax, ay, bx, by] = [mid(a[0]), mid(a[1]), mid(b[0]), mid(b[1])];
  d.begin("pencil"); d.line(ax, ay, bx, by, c);
  const ang = Math.atan2(by - ay, bx - ax);
  for (const s of [-1, 1]) { const t = ang + Math.PI + s * 0.6; d.line(bx, by, bx + Math.cos(t) * 3 * K, by + Math.sin(t) * 3 * K, c); }
};
export const disc = (d: PixelDraft, cx: number, cy: number, r: number, c: number) => {
  d.begin("fill");
  const ox = cx * K + K / 2, oy = cy * K + K / 2, R = (r + 0.5) * K - 0.5;
  for (let j = k(cy - r); j < k(cy + r + 1); j++) for (let i = k(cx - r); i < k(cx + r + 1); i++) if ((i + 0.5 - ox) ** 2 + (j + 0.5 - oy) ** 2 <= R * R) d.px(i, j, c);
};
export const ring = (d: PixelDraft, cx: number, cy: number, r: number, c: number) => {
  d.begin("pencil");
  const R = r * K + 0.5, n = Math.max(24, Math.round(R * 7));
  for (let q = 0; q < n; q++) { const t = (q / n) * Math.PI * 2; d.px(mid(cx) + Math.cos(t) * R, mid(cy) + Math.sin(t) * R, c); }
};
// A gauge: an arc from 8 o'clock round to 4 o'clock, filled to `value` in [0, 1].
export const dial = (d: PixelDraft, cx: number, cy: number, r: number, value: number, c: number, thick = 2) => {
  d.begin("cluster");
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, R = r * K + 0.5, steps = Math.round(R * 9), n = Math.round(steps * value);
  for (let q = 0; q <= n; q++) { const t = a0 + ((a1 - a0) * q) / steps; for (let w = 0; w < thick * K; w++) d.px(mid(cx) + Math.cos(t) * (R - w), mid(cy) + Math.sin(t) * (R - w), c); }
};

export const tick = (d: PixelDraft, x: number, y: number, c: number) => stroke(d, [[x, y + 2], [x + 2, y + 4], [x + 6, y]], c);
export const cross = (d: PixelDraft, x: number, y: number, c: number) => { stroke(d, [[x, y], [x + 4, y + 4]], c); stroke(d, [[x + 4, y], [x, y + 4]], c); };
export const dotted = (d: PixelDraft, a: Pt, b: Pt, c: number, gap = 3) => {
  d.begin("pencil");
  const [ax, ay, bx, by] = [mid(a[0]), mid(a[1]), mid(b[0]), mid(b[1])], n = Math.hypot(bx - ax, by - ay);
  for (let q = 0; q <= n; q += gap) d.px(ax + ((bx - ax) * q) / n, ay + ((by - ay) * q) / n, c);
};

// ---------------------------------------------------------------- lettering, a 5 x 9 pixel hand
const ADVANCE = 7;
const FONT: Record<string, string> = {
  A: ".###. #...# #...# #...# ##### #...# #...# #...# #...#", B: "####. #...# #...# #...# ####. #...# #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #.... #.... #...# .###.", D: "####. #...# #...# #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... #.... ####. #.... #.... #.... #####", F: "##### #.... #.... #.... ####. #.... #.... #.... #....",
  G: ".###. #...# #.... #.... #.### #...# #...# #...# .####", H: "#...# #...# #...# #...# ##### #...# #...# #...# #...#",
  I: ".###. ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.", J: "..### ...#. ...#. ...#. ...#. ...#. ...#. #..#. .##..",
  K: "#...# #...# #..#. #.#.. ##... #.#.. #..#. #...# #...#", L: "#.... #.... #.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...# #...# #...#", N: "#...# #...# ##..# ##..# #.#.# #..## #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# #...# #...# .###.", P: "####. #...# #...# #...# ####. #.... #.... #.... #....",
  Q: ".###. #...# #...# #...# #...# #...# #.#.# #..#. .##.#", R: "####. #...# #...# #...# ####. #.#.. #..#. #...# #...#",
  S: ".###. #...# #.... #.... .###. ....# ....# #...# .###.", T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# #...# #...# .###.", V: "#...# #...# #...# #...# #...# #...# .#.#. .#.#. ..#..",
  W: "#...# #...# #...# #...# #.#.# #.#.# #.#.# ##.## #...#", X: "#...# #...# .#.#. .#.#. ..#.. .#.#. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. .#.#. ..#.. ..#.. ..#.. ..#.. ..#..", Z: "##### ....# ...#. ...#. ..#.. .#... .#... #.... #####",
  "0": ".###. #...# #..## #..## #.#.# ##..# ##..# #...# .###.", "1": "..#.. .##.. #.#.. ..#.. ..#.. ..#.. ..#.. ..#.. #####",
  "2": ".###. #...# ....# ....# ...#. ..#.. .#... #.... #####", "3": ".###. #...# ....# ....# ..##. ....# ....# #...# .###.",
  "4": "...#. ..##. .#.#. #..#. #..#. ##### ...#. ...#. ...#.", "5": "##### #.... #.... ####. ....# ....# ....# #...# .###.",
  "6": ".###. #.... #.... #.... ####. #...# #...# #...# .###.", "7": "##### ....# ....# ...#. ...#. ..#.. ..#.. ..#.. ..#..",
  "8": ".###. #...# #...# #...# .###. #...# #...# #...# .###.", "9": ".###. #...# #...# #...# .#### ....# ....# ....# .###.",
  " ": "..... ..... ..... ..... ..... ..... ..... ..... .....", ".": "..... ..... ..... ..... ..... ..... ..... ..#.. ..#..",
  ",": "..... ..... ..... ..... ..... ..... ..#.. ..#.. .#...", ":": "..... ..... ..#.. ..#.. ..... ..... ..#.. ..#.. .....",
  "-": "..... ..... ..... ..... .###. ..... ..... ..... .....", "+": "..... ..... ..#.. ..#.. ##### ..#.. ..#.. ..... .....",
  "/": "....# ....# ...#. ...#. ..#.. .#... .#... #.... #....", "?": ".###. #...# ....# ....# ...#. ..#.. ..#.. ..... ..#..",
  "'": "..#.. ..#.. ..#.. ..... ..... ..... ..... ..... .....", "(": "...#. ..#.. .#... .#... .#... .#... .#... ..#.. ...#.",
  ")": ".#... ..#.. ...#. ...#. ...#. ...#. ...#. ..#.. .#...", "%": "##..# ##..# ...#. ...#. ..#.. .#... .#... #..## #..##",
  ">": "..... #.... .#... ..#.. ...#. ..#.. .#... #.... .....", "<": "..... ...#. ..#.. .#... #.... .#... ..#.. ...#. .....",
  "=": "..... ..... ..... ##### ..... ##### ..... ..... .....", "#": ".#.#. .#.#. ##### .#.#. .#.#. .#.#. ##### .#.#. .#.#.",
  "!": "..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..... ..... ..#..", _: "..... ..... ..... ..... ..... ..... ..... ..... #####",
  "~": "..... ..... ..... .#... #.#.# ...#. ..... ..... .....",
};
const GLYPHS = Object.fromEntries(Object.entries(FONT).map(([ch, g]) => [ch, g.split(" ")]));
// In design units, like every other coordinate.
export const textWidth = (s: string, scale = 1) => ((s.length * ADVANCE - (ADVANCE - 5)) * scale) / K;
export const text = (d: PixelDraft, x: number, y: number, s: string, c: number, scale = 1) => {
  d.begin("pencil");
  let cx = k(x);
  for (const ch of s.toUpperCase()) {
    (GLYPHS[ch] ?? GLYPHS["?"]).forEach((row, j) => [...row].forEach((bit, i) => { if (bit === "#") d.rect(cx + i * scale, k(y) + j * scale, scale, scale, c); }));
    cx += ADVANCE * scale;
  }
};
export const textCentred = (d: PixelDraft, cx: number, y: number, s: string, c: number, scale = 1) => text(d, cx - textWidth(s, scale) / 2, y, s, c, scale);
export const heading = (d: PixelDraft, s: string) => textCentred(d, 96, 3, s, C.ink, 2);
export const footer = (d: PixelDraft, s: string) => textCentred(d, 96, 103, s, C.half);
export const card = (d: PixelDraft, x: number, y: number, w: number, label: string, ink: number = C.ink, bg: number = C.paper) => { box(d, x, y, w, 9, ink, bg); text(d, x + 3, y + 2, label, ink === C.white ? C.white : C.ink); };

// ---------------------------------------------------------------- the cat, from the mark's own rects
const MARK: [number, number, number, number, number][] = [
  [14, 8, 20, 22, C.mark], [66, 8, 20, 22, C.mark], [10, 30, 80, 58, C.mark],
  [22, 20, 8, 8, C.teal], [70, 20, 8, 8, C.teal],
  [22, 44, 20, 16, C.white], [58, 44, 20, 16, C.white],
  [30, 48, 8, 10, C.coral], [62, 48, 8, 10, C.coral],
  [44, 68, 12, 8, C.teal], [4, 62, 10, 6, C.teal], [86, 62, 10, 6, C.teal],
];
export type Gaze = "ahead" | "left" | "right" | "shut";
// The mark rasterised at `size` design units per 100 mark units; a cell is on when its centre is inside a rect.
export const cat = (d: PixelDraft, x: number, y: number, size: number, gaze: Gaze = "ahead") => {
  const n = size * K, u = 100 / n;
  const lay = ([rx, ry, rw, rh, c]: (typeof MARK)[number], kind: "fill" | "pencil" = "fill") => {
    d.begin(kind);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const px = (i + 0.5) * u, py = (j + 0.5) * u; if (px >= rx && px < rx + rw && py >= ry && py < ry + rh) d.px(k(x) + i, k(y) + j, c); }
  };
  MARK.slice(0, 3).forEach((r) => lay(r));
  MARK.slice(3, 5).forEach((r) => lay(r, "pencil"));
  if (gaze === "shut") { MARK.slice(5, 7).forEach(([rx, ry, rw, rh]) => lay([rx, ry + 6, rw, 4, C.white], "pencil")); }
  else {
    MARK.slice(5, 7).forEach((r) => lay(r));
    const dx = gaze === "left" ? -4 : gaze === "right" ? 4 : 0;
    MARK.slice(7, 9).forEach(([rx, ry, rw, rh, c]) => lay([rx + dx, ry, rw, rh, c], "pencil"));
  }
  MARK.slice(9).forEach((r) => lay(r, "pencil"));
};

// ---------------------------------------------------------------- the film, and the same drawing for the page
export type Stage = { id: string; title: string; author: (d: PixelDraft) => void; budgets: number[]; seconds?: number; rest?: number; hold?: number };
// What apps/web loads from public/explainer: ops are `cell * 16 + colour`, `at(f)` how many apply at frame f.
export type Drawing = { title: string; G: number; H: number; fps: number; frames: number; palettes: typeof PALETTES; ops: () => number[]; at: (f: number) => number };
type Prepared = { d: PixelDraft; plan: number[] };

export const drawingFilm = (s: Stage): Film & { drawing: Drawing } => {
  const N = Math.round((s.seconds ?? 8) * FPS), HOLD = s.hold ?? 45, cels = Math.floor((N - HOLD - 1) / CEL);
  const prepare = (): Prepared => {
    const d = new PixelDraft(G, H, C.paper); s.author(d); d.end();
    const raw = celPlan(d, s.budgets, s.rest ?? 3);
    while (raw.length > 1 && raw[raw.length - 1] === raw[raw.length - 2]) raw.pop();
    return { d, plan: Array.from({ length: cels }, (_, c) => raw[Math.min(raw.length - 1, Math.round((c * (raw.length - 1)) / (cels - 1)))]) };
  };
  const opsAt = ({ d, plan }: Prepared, f: number) => (f === 0 ? 0 : f >= N - HOLD ? d.ops.length : plan[Math.min(plan.length - 1, Math.floor((f - 1) / CEL))]);
  const cached = (env: Env) => {
    let v = env.cache.get(`lintcat/${s.id}`) as Prepared | undefined;
    if (!v) { v = prepare(); env.cache.set(`lintcat/${s.id}`, v); }
    return v;
  };
  let page: Prepared | undefined;
  const onPage = () => (page ??= prepare());
  return {
    meta: { title: s.title, W: G * 4, H: H * 4, fps: FPS, bpm: BPM, durationFrames: N, kind: "drawing", raster: "cpu", holds: [[2 + (cels - 1) * CEL, N]] },
    assets: { images: {} },
    shots: [{
      id: s.id, start: 0, end: N, draw: (ctx, f, env) => {
        const v = cached(env), n = opsAt(v, f);
        const buf = new Uint8Array(G * H).fill(C.paper);
        for (let q = 0; q < n; q++) { const o = v.d.ops[q]; buf[o >> 4] = o & 15; }
        blit(ctx, buf, G, H, PALETTES.light, Math.round(env.W * env.scale), Math.round(env.H * env.scale), PALETTES.light[C.paper]);
      },
    }],
    drawing: { title: s.title, G, H, fps: FPS, frames: N, palettes: PALETTES, ops: () => onPage().d.ops, at: (f) => opsAt(onPage(), f) },
  };
};
