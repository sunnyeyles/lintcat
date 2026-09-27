// LINTCAT KIT. Pixel-art explainer pieces on a 192 x 108 grid in the brand palette.
// A stage authors passes into a PixelDraft; `drawingFilm` replays them, cel by cel, then holds.
import type { Env } from "./core";
import type { Film } from "./film";
import { blit, celPlan, PixelDraft } from "./pixelArtKit";

export const G = 192, H = 108;
export const FPS = 30, BPM = 120, CEL = 3;

// Brand hex from apps/web/public/brand/*.svg; the rest are tints for dither and one amber.
export const PALETTE = [
  "#F5EFE3", // 0 paper (cream), the ground
  "#E4DCC9", // 1 paper shade
  "#C9BFA8", // 2 rule, faint line
  "#1E2D42", // 3 navy ink
  "#3A4A63", // 4 navy lit
  "#8C96A8", // 5 navy half
  "#3AA693", // 6 teal
  "#25776A", // 7 teal deep
  "#A8DCD1", // 8 teal tint
  "#F47B4E", // 9 coral
  "#BF4E28", // 10 coral deep
  "#F9C9B5", // 11 coral tint
  "#E9B23C", // 12 amber
  "#FFFFFF", // 13 white
  "#B9B3DD", // 14 lavender, the untrusted zone
  "#0E1826", // 15 ink deepest
];
export const C = {
  paper: 0, shade: 1, rule: 2, ink: 3, inkLit: 4, half: 5, teal: 6, tealDeep: 7, tealTint: 8,
  coral: 9, coralDeep: 10, coralTint: 11, amber: 12, white: 13, lavender: 14, black: 15,
} as const;

export type Pt = [number, number];

// ---------------------------------------------------------------- marks
export const fill = (d: PixelDraft, x: number, y: number, w: number, h: number, c: number) => { d.begin("fill"); d.rect(x, y, w, h, c); };
export const stroke = (d: PixelDraft, pts: Pt[], c: number) => { d.begin("pencil"); for (let i = 0; i + 1 < pts.length; i++) d.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c); };
export const box = (d: PixelDraft, x: number, y: number, w: number, h: number, c: number, bg?: number) => {
  if (bg !== undefined) fill(d, x + 1, y + 1, w - 2, h - 2, bg);
  stroke(d, [[x, y], [x + w - 1, y], [x + w - 1, y + h - 1], [x, y + h - 1], [x, y]], c);
};
export const dither = (d: PixelDraft, x: number, y: number, w: number, h: number, c: number, level = 2) => {
  d.begin("cluster");
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (PixelDraft.dith(i, j, level)) d.px(i, j, c);
};
// An arrow: the shaft as one pencil line, the head as two short strokes at the tip.
export const arrow = (d: PixelDraft, a: Pt, b: Pt, c: number) => {
  d.begin("pencil"); d.line(a[0], a[1], b[0], b[1], c);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  for (const s of [-1, 1]) { const t = ang + Math.PI + s * 0.6; d.line(b[0], b[1], b[0] + Math.cos(t) * 3, b[1] + Math.sin(t) * 3, c); }
};
export const disc = (d: PixelDraft, cx: number, cy: number, r: number, c: number) => {
  d.begin("fill");
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.5) d.px(cx + x, cy + y, c);
};
export const ring = (d: PixelDraft, cx: number, cy: number, r: number, c: number) => {
  d.begin("pencil");
  const n = Math.max(12, Math.round(r * 7));
  for (let k = 0; k < n; k++) { const t = (k / n) * Math.PI * 2; d.px(cx + Math.cos(t) * r, cy + Math.sin(t) * r, c); }
};
// A gauge: an arc from 8 o'clock round to 4 o'clock, filled to `value` in [0, 1].
export const dial = (d: PixelDraft, cx: number, cy: number, r: number, value: number, c: number, thick = 2) => {
  d.begin("cluster");
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, n = Math.round(r * 9 * value);
  for (let k = 0; k <= n; k++) { const t = a0 + ((a1 - a0) * k) / (r * 9); for (let w = 0; w < thick; w++) d.px(cx + Math.cos(t) * (r - w), cy + Math.sin(t) * (r - w), c); }
};

export const tick = (d: PixelDraft, x: number, y: number, c: number) => stroke(d, [[x, y + 2], [x + 2, y + 4], [x + 6, y]], c);
export const cross = (d: PixelDraft, x: number, y: number, c: number) => { stroke(d, [[x, y], [x + 4, y + 4]], c); stroke(d, [[x + 4, y], [x, y + 4]], c); };
export const dotted = (d: PixelDraft, a: Pt, b: Pt, c: number, gap = 3) => {
  d.begin("pencil");
  const n = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let k = 0; k <= n; k += gap) d.px(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, c);
};

// ---------------------------------------------------------------- lettering, a 3 x 5 pixel hand
const FONT: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"], C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"], E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"], I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"], K: ["101", "101", "110", "101", "101"], L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"], N: ["110", "101", "101", "101", "101"], O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"], Q: ["010", "101", "101", "011", "001"], R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"], U: ["101", "101", "101", "101", "011"],
  V: ["101", "101", "101", "101", "010"], W: ["101", "101", "111", "111", "101"], X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  "0": ["010", "101", "101", "101", "010"], "1": ["010", "110", "010", "010", "111"], "2": ["110", "001", "010", "100", "111"],
  "3": ["110", "001", "010", "001", "110"], "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "110", "101", "010"], "7": ["111", "001", "010", "010", "010"], "8": ["010", "101", "010", "101", "010"],
  "9": ["010", "101", "011", "001", "110"],
  " ": ["000", "000", "000", "000", "000"], ".": ["000", "000", "000", "000", "010"], ",": ["000", "000", "000", "010", "100"],
  ":": ["000", "010", "000", "010", "000"], "-": ["000", "000", "111", "000", "000"], "+": ["000", "010", "111", "010", "000"],
  "/": ["001", "001", "010", "100", "100"], "?": ["110", "001", "010", "000", "010"], "'": ["010", "010", "000", "000", "000"],
  "(": ["001", "010", "010", "010", "001"], ")": ["100", "010", "010", "010", "100"], "%": ["101", "001", "010", "100", "101"],
  ">": ["100", "010", "001", "010", "100"], "<": ["001", "010", "100", "010", "001"], "=": ["000", "111", "000", "111", "000"],
  "#": ["101", "111", "101", "111", "101"], "!": ["010", "010", "010", "000", "010"], "_": ["000", "000", "000", "000", "111"],
  "~": ["000", "011", "110", "000", "000"],
};
export const textWidth = (s: string, scale = 1) => s.length * 4 * scale - scale;
export const text = (d: PixelDraft, x: number, y: number, s: string, c: number, scale = 1) => {
  d.begin("pencil");
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] ?? FONT["?"];
    g.forEach((row, j) => [...row].forEach((bit, i) => { if (bit === "1") d.rect(cx + i * scale, y + j * scale, scale, scale, c); }));
    cx += 4 * scale;
  }
};
export const textCentred = (d: PixelDraft, cx: number, y: number, s: string, c: number, scale = 1) => text(d, Math.round(cx - textWidth(s, scale) / 2), y, s, c, scale);
export const heading = (d: PixelDraft, s: string) => textCentred(d, 96, 3, s, C.ink, 2);
export const footer = (d: PixelDraft, s: string) => textCentred(d, 96, 103, s, C.half);
export const card = (d: PixelDraft, x: number, y: number, w: number, label: string, ink = C.ink, bg = C.paper) => { box(d, x, y, w, 9, ink, bg); text(d, x + 3, y + 2, label, ink === C.white ? C.white : C.ink); };

// ---------------------------------------------------------------- the cat, from the mark's own rects
const MARK: [number, number, number, number, number][] = [
  [14, 8, 20, 22, C.ink], [66, 8, 20, 22, C.ink], [10, 30, 80, 58, C.ink],
  [22, 20, 8, 8, C.teal], [70, 20, 8, 8, C.teal],
  [22, 44, 20, 16, C.white], [58, 44, 20, 16, C.white],
  [30, 48, 8, 10, C.coral], [62, 48, 8, 10, C.coral],
  [44, 68, 12, 8, C.teal], [4, 62, 10, 6, C.teal], [86, 62, 10, 6, C.teal],
];
export type Gaze = "ahead" | "left" | "right" | "shut";
// The mark rasterised at `size` cells per 100 units; a cell is on when its centre is inside a rect.
export const cat = (d: PixelDraft, x: number, y: number, size: number, gaze: Gaze = "ahead") => {
  const u = 100 / size;
  const lay = ([rx, ry, rw, rh, c]: (typeof MARK)[number], kind: "fill" | "pencil" = "fill") => {
    d.begin(kind);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const px = (i + 0.5) * u, py = (j + 0.5) * u; if (px >= rx && px < rx + rw && py >= ry && py < ry + rh) d.px(x + i, y + j, c); }
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

// ---------------------------------------------------------------- the film
export type Stage = { id: string; title: string; author: (d: PixelDraft) => void; budgets: number[]; seconds?: number; rest?: number; hold?: number };
export const drawingFilm = (s: Stage): Film => {
  const N = Math.round((s.seconds ?? 8) * FPS), HOLD = s.hold ?? 45, cels = Math.floor((N - HOLD - 1) / CEL);
  const cached = (env: Env) => {
    let v = env.cache.get(`lintcat/${s.id}`) as { d: PixelDraft; plan: number[] } | undefined;
    if (!v) {
      const d = new PixelDraft(G, H, C.paper); s.author(d); d.end();
      const raw = celPlan(d, s.budgets, s.rest ?? 3);
      while (raw.length > 1 && raw[raw.length - 1] === raw[raw.length - 2]) raw.pop();
      const plan = Array.from({ length: cels }, (_, c) => raw[Math.min(raw.length - 1, Math.round((c * (raw.length - 1)) / (cels - 1)))]);
      v = { d, plan }; env.cache.set(`lintcat/${s.id}`, v);
    }
    return v;
  };
  return {
    meta: { title: s.title, W: G * 10, H: H * 10, fps: FPS, bpm: BPM, durationFrames: N, kind: "drawing", raster: "cpu", holds: [[2 + (cels - 1) * CEL, N]] },
    assets: { images: {} },
    shots: [{
      id: s.id, start: 0, end: N, draw: (ctx, f, env) => {
        const { d, plan } = cached(env);
        const n = f === 0 ? 0 : f >= N - HOLD ? d.ops.length : plan[Math.min(plan.length - 1, Math.floor((f - 1) / CEL))];
        const buf = new Uint8Array(G * H).fill(C.paper);
        for (let k = 0; k < n; k++) { const o = d.ops[k]; buf[o >> 4] = o & 15; }
        blit(ctx, buf, G, H, PALETTE, Math.round(env.W * env.scale), Math.round(env.H * env.scale), PALETTE[C.paper]);
      },
    }],
  };
};
