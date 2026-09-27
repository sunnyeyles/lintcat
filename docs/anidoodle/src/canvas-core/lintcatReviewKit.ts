// PIXEL EXPLAINER KIT. A bitmap font, the LintCat mark as rects, and a timeline of steps whose ops
// replay strictly monotonically, so no two consecutive cels can ever be identical.
import { PixelDraft } from "anidoodle-engine/canvas-core/pixelArtKit";
import { C, LUMA, PALETTE } from "./lintcatReviewPalette";

export const G = 192, H = 108, CEL = 3, BEAT = 15;

// ---------------------------------------------------------------- the font: 5 x 7, uppercase
const F = (...rows: string[]) => rows;
export const FONT: Record<string, string[]> = {
  A: F(".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
  B: F("####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."),
  C: F(".####", "#....", "#....", "#....", "#....", "#....", ".####"),
  D: F("####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."),
  E: F("#####", "#....", "#....", "####.", "#....", "#....", "#####"),
  F: F("#####", "#....", "#....", "####.", "#....", "#....", "#...."),
  G: F(".####", "#....", "#....", "#.###", "#...#", "#...#", ".####"),
  H: F("#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
  I: F("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"),
  J: F("..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."),
  K: F("#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"),
  L: F("#....", "#....", "#....", "#....", "#....", "#....", "#####"),
  M: F("#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"),
  N: F("#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"),
  O: F(".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
  P: F("####.", "#...#", "#...#", "####.", "#....", "#....", "#...."),
  Q: F(".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"),
  R: F("####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"),
  S: F(".####", "#....", "#....", ".###.", "....#", "....#", "####."),
  T: F("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
  U: F("#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
  V: F("#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."),
  W: F("#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"),
  X: F("#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"),
  Y: F("#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."),
  Z: F("#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"),
  "0": F(".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."),
  "1": F("..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."),
  "2": F(".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"),
  "3": F("#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."),
  "4": F("...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."),
  "5": F("#####", "#....", "####.", "....#", "....#", "#...#", ".###."),
  "6": F("..###", ".#...", "#....", "####.", "#...#", "#...#", ".###."),
  "7": F("#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."),
  "8": F(".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."),
  "9": F(".###.", "#...#", "#...#", ".####", "....#", "...#.", "###.."),
  " ": F("...", "...", "...", "...", "...", "...", "..."),
  ".": F("..", "..", "..", "..", "..", "##", "##"),
  ",": F("..", "..", "..", "..", ".#", ".#", "#."),
  ":": F("..", "##", "##", "..", "##", "##", ".."),
  "/": F("....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."),
  "+": F(".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."),
  "-": F(".....", ".....", ".....", "#####", ".....", ".....", "....."),
  "'": F("#", "#", ".", ".", ".", ".", "."),
  "?": F(".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."),
  "#": F(".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."),
  "!": F("#", "#", "#", "#", "#", ".", "#"),
};
const glyph = (ch: string) => FONT[ch] ?? FONT[ch.toUpperCase()] ?? FONT["?"];

export const textWidth = (s: string, k = 1) => [...s].reduce((w, ch) => w + (glyph(ch)[0].length + 1) * k, 0) - k;

// Lays a string glyph by glyph at k cells per font pixel; ops land in reading order, so a step draws it on as typing.
export const text = (d: PixelDraft, s: string, x: number, y: number, c: number, k = 1) => {
  let cx = x;
  for (const ch of s) {
    const rows = glyph(ch);
    rows.forEach((r, j) => [...r].forEach((p, i) => { if (p === "#") d.rect(cx + i * k, y + j * k, k, k, c); }));
    cx += (rows[0].length + 1) * k;
  }
  return cx - x - k;
};

// ---------------------------------------------------------------- rect sprites
export type Rects = [x: number, y: number, w: number, h: number, c: number][];
export type Placement = { rects: Rects; x: number; y: number };

export const paintRects = (d: PixelDraft, rects: Rects, ox = 0, oy = 0) => rects.forEach(([x, y, w, h, c]) => d.rect(ox + x, oy + y, w, h, c));
export const stampRects = (buf: Uint8Array, rects: Rects, ox = 0, oy = 0) => {
  for (const [x, y, w, h, c] of rects) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const X = ox + x + i, Y = oy + y + j; if (X >= 0 && Y >= 0 && X < G && Y < H) buf[Y * G + X] = c; }
};

// ASCII sprite -> rects, one per run, for the small icons.
export const sprite = (rows: string[], map: Record<string, number>): Rects => {
  const out: Rects = [];
  rows.forEach((r, j) => { let i = 0; while (i < r.length) { const ch = r[i]; if (ch === "." || map[ch] === undefined) { i++; continue; } let e = i + 1; while (e < r.length && r[e] === ch) e++; out.push([i, j, e - i, 1, map[ch]]); i = e; } });
  return out;
};

export const CHECK = sprite(["....#", "...##", "#.##.", "###..", ".#..."], { "#": C.turquoise });
export const CROSS = sprite(["#...#", ".#.#.", "..#..", ".#.#.", "#...#"], { "#": C.coral });
export const MINI_CAT = sprite(["#....#", "######", "#e##e#", "######", ".####."], { "#": C.navy, e: C.paper });

// ---------------------------------------------------------------- the LintCat mark
// The brand SVG's rects on its 100-unit grid; size 2 halves them (all even), size 4 is the hand-fitted small cat.
export type Pose = { eyes: "open" | "shut"; look: -1 | 0 | 1; whisk: 0 | 1 };
export const REST: Pose = { eyes: "open", look: 0, whisk: 0 };
type Part = "ears" | "head" | "innerEars" | "eyes" | "pupils" | "nose" | "whiskers";
const BIG: Record<Part, Rects> = {
  ears: [[7, 4, 10, 11, C.navy], [33, 4, 10, 11, C.navy]],
  head: [[5, 15, 40, 29, C.navy]],
  innerEars: [[11, 10, 4, 4, C.turquoise], [35, 10, 4, 4, C.turquoise]],
  eyes: [[11, 22, 10, 8, C.white], [29, 22, 10, 8, C.white]],
  pupils: [[15, 24, 4, 5, C.coral], [31, 24, 4, 5, C.coral]],
  nose: [[22, 34, 6, 4, C.turquoise]],
  whiskers: [[2, 31, 5, 3, C.turquoise], [43, 31, 5, 3, C.turquoise]],
};
const SMALL: Record<Part, Rects> = {
  ears: [[4, 2, 5, 6, C.navy], [17, 2, 5, 6, C.navy]],
  head: [[3, 8, 20, 14, C.navy]],
  innerEars: [[6, 5, 2, 2, C.turquoise], [18, 5, 2, 2, C.turquoise]],
  eyes: [[6, 11, 5, 4, C.white], [15, 11, 5, 4, C.white]],
  pupils: [[8, 12, 2, 3, C.coral], [16, 12, 2, 3, C.coral]],
  nose: [[11, 17, 3, 2, C.turquoise]],
  whiskers: [[1, 16, 3, 2, C.turquoise], [22, 16, 3, 2, C.turquoise]],
};
export const MARK_ORDER: Part[] = ["ears", "head", "innerEars", "eyes", "pupils", "nose", "whiskers"];
export const markPart = (size: 2 | 4, part: Part): Rects => (size === 2 ? BIG : SMALL)[part];
// Size 2 spans 50 x 48 cells from (0,0); size 4 spans 26 x 22.
export const catRects = (size: 2 | 4, pose: Pose = REST): Rects => {
  const P = size === 2 ? BIG : SMALL, u = size === 2 ? 2 : 1;
  const out: Rects = [...P.ears, ...P.head, ...P.innerEars, ...P.nose];
  if (pose.eyes === "open") {
    out.push(...P.eyes);
    out.push(...P.pupils.map(([x, y, w, h, c]) => [x + pose.look * u, y, w, h, c] as Rects[number]));
  } else {
    out.push(...P.eyes.map(([x, y, w, h, c]) => [x, y + ((h - u) >> 1), w, u, c] as Rects[number]));
  }
  out.push(...P.whiskers.map(([x, y, w, h, c]) => [x, y - pose.whisk * u, w, h, c] as Rects[number]));
  return out;
};

// ---------------------------------------------------------------- steps and chapters
export type Step = { id: string; from: number; to: number; ops: number[] }; // cels, `to` exclusive
export type Chapter = { id: string; start: number; end: number; steps: Step[]; stamps: (cel: number) => Placement[] };

// Records one chapter's scenery as steps sliced from a single draft, in the order they will replay.
export class Author {
  readonly d = new PixelDraft(G, H, C.paper);
  readonly steps: Step[] = [];
  step(id: string, from: number, to: number, paint: (d: PixelDraft) => void) {
    const a = this.d.ops.length; paint(this.d); const ops = this.d.ops.slice(a);
    if (ops.length === 0) throw new Error(`step ${id} lays nothing`);
    this.steps.push({ id, from, to, ops });
  }
  chapter(id: string, start: number, end: number, stamps: (cel: number) => Placement[] = () => []): Chapter {
    return { id, start, end, steps: this.steps, stamps };
  }
}

export const opsAt = (s: Step, cel: number) => (cel < s.from ? 0 : cel >= s.to ? s.ops.length : Math.floor((s.ops.length * (cel - s.from + 1)) / (s.to - s.from)));

export const compose = (ch: Chapter, cel: number, buf: Uint8Array) => {
  for (const s of ch.steps) { const n = opsAt(s, cel); for (let k = 0; k < n; k++) { const o = s.ops[k]; buf[o >> 4] = o & 15; } }
  for (const p of ch.stamps(cel)) stampRects(buf, p.rects, p.x, p.y);
};

// Simulates every cel and refuses a timeline the gate would fail: gaps, repeats, or a quiet second.
// The gate counts changed pixels on a 270x152 greyscale: about 2 px per cell plus a half-cell fringe; 0.5% is 205 px.
export const checkTimeline = (chapters: Chapter[], durationFrames: number, holds: [number, number][], minCel = 4, minWindow = 240) => {
  const problems: string[] = [];
  let t = 0;
  for (const ch of chapters) {
    if (ch.start !== t) problems.push(`${ch.id} starts at ${ch.start}, expected ${t}`);
    if (ch.start % BEAT) problems.push(`${ch.id} starts off the beat`);
    if ((ch.end - ch.start) % CEL) problems.push(`${ch.id} is not a whole number of cels`);
    const cels = (ch.end - ch.start) / CEL;
    let last = -1;
    for (const s of ch.steps) {
      if (s.from < last) problems.push(`${ch.id}/${s.id} is out of order`);
      last = s.from;
      if (s.to <= s.from || s.from < 0 || s.to > cels) problems.push(`${ch.id}/${s.id} range ${s.from}-${s.to} outside 0-${cels}`);
      if (s.ops.length < s.to - s.from) problems.push(`${ch.id}/${s.id} has ${s.ops.length} ops for ${s.to - s.from} cels`);
    }
    t = ch.end;
  }
  if (t !== durationFrames) problems.push(`chapters end at ${t}, film is ${durationFrames}`);
  if (problems.length) return problems;
  const inHold = (f: number) => holds.some(([a, b]) => f >= a && f < b);
  const strong: number[] = [];
  let prev = new Uint8Array(G * H).fill(C.paper);
  const mask = new Uint8Array(G * H);
  for (const ch of chapters) {
    for (let cel = 0; cel * CEL + ch.start < ch.end; cel++) {
      const buf = new Uint8Array(G * H).fill(C.paper);
      compose(ch, cel, buf);
      let n = 0, dilated = 0;
      for (let i = 0; i < buf.length; i++) { mask[i] = buf[i] !== prev[i] && Math.abs(LUMA[buf[i]] - LUMA[prev[i]]) >= 8 ? 1 : 0; n += mask[i]; }
      for (let y = 0; y < H; y++) for (let x = 0; x < G; x++) {
        let hit = 0;
        for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < G && Y < H && mask[Y * G + X]) hit = 1; }
        dilated += hit;
      }
      const frame = ch.start + cel * CEL;
      if (n < minCel && !inHold(frame) && frame > 0) problems.push(`${ch.id} cel ${cel} (frame ${frame}) changes only ${n} cells`);
      strong.push(Math.round(1.98 * (n + 0.5 * (dilated - n))));
      prev = buf;
    }
  }
  for (let i = 0; i + 5 <= strong.length; i++) {
    const frames = Array.from({ length: 5 }, (_, k) => (i + k) * CEL);
    if (frames.every(inHold)) continue;
    const m = Math.max(...strong.slice(i, i + 5));
    if (m < minWindow) problems.push(`quiet second at frames ${frames[0]}-${frames[4] + CEL}: best cel changes about ${m} px of 205 needed`);
  }
  if (PALETTE.length > 16) problems.push("more than 16 colours");
  return problems;
};
