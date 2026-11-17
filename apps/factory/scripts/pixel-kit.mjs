// Drawing primitives for characters.mjs: shaded shapes, outlined layers, robot parts, PNG output.
import { crc32, deflateSync } from "node:zlib";

export const SIZE = 120;

export const hex = (s, a = 255) => [...[1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)), a];
export const ramp = (...cs) => cs.map((c) => hex(c));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export const INK = hex("#17191d");
export const SHADE = hex("#1f2422");
export const WHITE = hex("#ffffff");
export const STEEL = ramp("#353b3f", "#4d565a", "#697377", "#869094", "#a3acaf", "#c2c9cb");
export const IRON = ramp("#1e2226", "#2b3035", "#3a4045", "#4c5358", "#60686d");
export const GLASS = ramp("#39433f", "#4e5a56", "#65726e", "#7d8a86", "#96a29e", "#aab5b1");
export const PAPER = ramp("#a89f84", "#cfc5a3", "#e8dfc0", "#f6f0d8");
export const WOOD = ramp("#5a3d24", "#7a5531", "#9c7141", "#bd8f58");
export const BRASS = ramp("#6b5320", "#93742c", "#bd9a3e", "#e0c264");
export const RED = ramp("#7a1616", "#b32222", "#e03a2f", "#ff7a66");
export const GOLD = ramp("#8a6a12", "#c79a1c", "#f2c530", "#ffe88a");
const TOOTH = hex("#e8dcb5");

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x, y) => BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5;

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const layer = (w = SIZE, h = SIZE) => ({ w, h, d: new Uint8ClampedArray(w * h * 4) });

const alpha = (L, x, y) =>
  x < 0 || y < 0 || x >= L.w || y >= L.h ? 0 : L.d[(y * L.w + x) * 4 + 3];

export function put(L, x, y, c) {
  if (x < 0 || y < 0 || x >= L.w || y >= L.h) return;
  const i = (y * L.w + x) * 4;
  const a = c[3] / 255;
  const under = (L.d[i + 3] / 255) * (1 - a);
  const out = a + under;
  if (out === 0) return;
  for (let k = 0; k < 3; k++) L.d[i + k] = (c[k] * a + L.d[i + k] * under) / out;
  L.d[i + 3] = out * 255;
}

export function erase(L, x, y, w, h) {
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++) if (alpha(L, px, py)) L.d[(py * L.w + px) * 4 + 3] = 0;
}

export function fill(L, x, y, w, h, c) {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) put(L, px, py, c);
}

export function line(L, x0, y0, x1, y1, c, th = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const o = (th - 1) >> 1;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    fill(L, x - o, y - o, th, th, c);
  }
}

export const path = (L, pts, c, th = 1) =>
  pts.slice(1).forEach((p, i) => line(L, ...pts[i], ...p, c, th));

const rrect = (x, y, w, h, r) => (px, py) => {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const dx = Math.max(x + r - px - 0.5, px + 0.5 - (x + w - r), 0);
  const dy = Math.max(y + r - py - 0.5, py + 0.5 - (y + h - r), 0);
  return dx * dx + dy * dy <= r * r;
};

export const disc = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r + r * 0.8;

const polygon = (pts) => (px, py) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Lit from the top left; edges get a one-step bevel.
export function shade(L, [x0, y0, x1, y1], inside, rmp, base = 0.62) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      let t = base - 0.34 * ((y - y0) / h) - 0.12 * ((x - x0) / w);
      if (!inside(x, y - 1) || !inside(x - 1, y)) t += 0.22;
      else if (!inside(x, y + 1) || !inside(x + 1, y)) t -= 0.25;
      else if (!inside(x, y + 2) || !inside(x + 2, y)) t -= 0.1;
      t += (dither(x, y) * 0.9) / rmp.length;
      put(L, x, y, rmp[Math.max(0, Math.min(rmp.length - 1, Math.floor(t * rmp.length)))]);
    }
}

export const box = (L, x, y, w, h, r, rmp, base) =>
  shade(L, [x, y, x + w - 1, y + h - 1], rrect(x, y, w, h, r), rmp, base);

export const ball = (L, cx, cy, r, rmp, base) =>
  shade(L, [cx - r, cy - r, cx + r, cy + r], disc(cx, cy, r), rmp, base);

export function poly(L, pts, rmp, base) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  shade(L, bounds, polygon(pts), rmp, base);
}

export function ring(L, cx, cy, r, c, th = 0.8) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++)
    for (let x = cx - r - 1; x <= cx + r + 1; x++)
      if (Math.abs(Math.hypot(x - cx, y - cy) - r) < th) put(L, x, y, c);
}

// Scanlined screen glass, brightest in the middle.
export function glass(L, [x0, y0, x1, y1], inside, tint = GLASS) {
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      const d = Math.hypot((x + 0.5 - cx) / (cx - x0), (y + 0.5 - cy) / (cy - y0));
      const t = 0.88 - 0.5 * d * d - (y & 1 ? 0.09 : 0) + dither(x, y) / tint.length;
      put(L, x, y, tint[Math.max(0, Math.min(tint.length - 1, Math.floor(t * tint.length)))]);
    }
}

export function crt(L, x, y, w, h, r = 5, tint = GLASS) {
  box(L, x, y, w, h, r, IRON, 0.5);
  const inner = [x + 2, y + 2, x + w - 3, y + h - 3];
  glass(L, inner, rrect(x + 2, y + 2, w - 4, h - 4, Math.max(r - 1, 2)), tint);
  line(L, x + 5, y + 8, x + 9, y + 4, mix(tint.at(-1), WHITE, 0.45));
}

export function eye(L, cx, cy, r, c, shut = false) {
  if (shut) return fill(L, cx - r, cy, 2 * r + 1, 1, c);
  for (let y = cy - r - 4; y <= cy + r + 4; y++)
    for (let x = cx - r - 4; x <= cx + r + 4; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r && d <= r + 3.6) put(L, x, y, [c[0], c[1], c[2], 150 * (1 - (d - r) / 3.8)]);
    }
  const core = mix(c, WHITE, 0.4);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (disc(cx, cy, r)(x, y)) put(L, x, y, c);
      if (r > 1 && disc(cx, cy, r - 1)(x, y)) put(L, x, y, core);
    }
  put(L, cx, cy, mix(c, WHITE, 0.85));
  if (r > 2) put(L, cx - 1, cy - 1, mix(c, WHITE, 0.85));
}

export const mouth = (L, pts) => {
  path(L, pts, SHADE);
  path(L, pts.map(([x, y]) => [x, y + 1]), SHADE);
};

// curve > 0 lifts the corners into a grin, < 0 drops them into a scowl.
export function teeth(L, x, y, w, h, curve = 0) {
  for (let i = 0; i < w; i++) {
    const u = (i - (w - 1) / 2) / ((w - 1) / 2);
    const top = y - Math.round(curve * u * u);
    fill(L, x + i, top - 1, 1, h + 2, SHADE);
    if (i === 0 || i === w - 1 || i % 5 === 4) continue;
    fill(L, x + i, top, 1, h, TOOTH);
    put(L, x + i, top + (h >> 1), SHADE);
    put(L, x + i, top + h - 1, mix(TOOTH, SHADE, 0.3));
  }
}

export function seam(L, x0, y0, x1, y1) {
  const [dx, dy] = x0 === x1 ? [1, 0] : [0, 1];
  line(L, x0, y0, x1, y1, IRON[2]);
  line(L, x0 + dx, y0 + dy, x1 + dx, y1 + dy, STEEL[4]);
}

export function vent(L, x, y, w, n) {
  for (let i = 0; i < n; i++) {
    fill(L, x, y + i * 3, w, 1, IRON[0]);
    fill(L, x, y + i * 3 + 1, w, 1, STEEL[4]);
  }
}

export function tread(L, x, y, w, h, shift = 0) {
  box(L, x, y, w, h, Math.min(6, h >> 1), IRON, 0.55);
  for (let i = x + 3 + (shift % 3); i < x + w - 3; i += 3) {
    put(L, i, y, IRON[4]);
    put(L, i, y + h - 1, IRON[0]);
  }
  const r = (h >> 1) - 3;
  const count = Math.max(2, Math.floor((w - 6) / (2 * r + 2)));
  for (let i = 0; i < count; i++) {
    const cx = Math.round(x + r + 3 + (i * (w - 2 * r - 7)) / (count - 1));
    ball(L, cx, y + (h >> 1), r, STEEL, 0.5);
    put(L, cx, y + (h >> 1), INK);
  }
}

export function wheel(L, cx, cy, r, turn = 0) {
  ball(L, cx, cy, r, IRON, 0.6);
  ball(L, cx, cy, r - 3, STEEL, 0.55);
  ball(L, cx, cy, 1, IRON, 0.3);
  const a = (turn * Math.PI) / 4;
  for (const s of [-1, 1])
    put(L, Math.round(cx + s * Math.cos(a) * (r - 5)), Math.round(cy + s * Math.sin(a) * (r - 5)), INK);
}

function claw(L, x, y, [dx, dy]) {
  for (const s of [-1, 1]) {
    const at = (f, p) => [x + dx * f - dy * p * s, y + dy * f + dx * p * s];
    path(L, [at(0, 2), at(3, 4), at(6, 2)], STEEL[2], 2);
    put(L, ...at(3, 4), STEEL[4]);
  }
  ball(L, x, y, 2, STEEL, 0.6);
}

// Draws into its own layer, then stamps it at an offset with a dark outline.
export function part(M, draw, dx = 0, dy = 0) {
  const L = layer(M.w, M.h);
  draw(L);
  for (let y = 0; y < L.h; y++)
    for (let x = 0; x < L.w; x++) {
      if (alpha(L, x, y) > 200) continue;
      const near = [alpha(L, x - 1, y), alpha(L, x + 1, y), alpha(L, x, y - 1), alpha(L, x, y + 1)];
      if (near.some((a) => a > 200)) put(M, x + dx, y + dy, INK);
    }
  blit(M, L, dx, dy);
}

export function blit(M, L, ox, oy) {
  for (let y = 0; y < L.h; y++)
    for (let x = 0; x < L.w; x++) {
      const i = (y * L.w + x) * 4;
      if (L.d[i + 3]) put(M, x + ox, y + oy, L.d.subarray(i, i + 4));
    }
}

export function arm(M, pts, grip) {
  part(M, (L) => {
    path(L, pts, STEEL[1], 3);
    path(L, pts.map(([x, y]) => [x, y - 1]), STEEL[3]);
    for (const [x, y] of pts.slice(0, -1)) {
      ball(L, x, y, 2, STEEL, 0.6);
      put(L, x, y, IRON[0]);
    }
    claw(L, ...pts.at(-1), grip);
  });
}

const GLYPHS = {
  a: "010101111101101", c: "011100100100011", d: "110101101101110", e: "111100110100111",
  f: "111100110100100", h: "101101111101101", i: "111010010010111", l: "100100100100111",
  m: "1000111011101011000110001", n: "111101101101101", o: "010101101101010", p: "110101110100100",
  r: "110101110101101", s: "011100010001110", t: "111010010010010", u: "101101101101111",
  v: "101101101010010", w: "1000110001101011101110001", y: "101101010010010",
};

export function text(L, str, cx, y, c, scale = 2) {
  const glyphs = [...str].map((ch) => GLYPHS[ch] ?? "");
  const width = glyphs.reduce((sum, g) => sum + g.length / 5 + 1, -1);
  let x = cx - Math.round((width * scale) / 2);
  for (const bits of glyphs) {
    const w = bits.length / 5;
    for (let i = 0; i < bits.length; i++)
      if (bits[i] === "1") fill(L, x + (i % w) * scale, y + Math.floor(i / w) * scale, scale, scale, c);
    x += (w + 1) * scale;
  }
}

// More than one frame makes an animated PNG that loops forever.
export function png(frames, scale, delay = 120) {
  const w = frames[0].w * scale;
  const h = frames[0].h * scale;
  const pack = (L) => {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const src = (Math.floor(y / scale) * L.w + Math.floor(x / scale)) * 4;
        raw.set(L.d.subarray(src, src + 4), y * (w * 4 + 1) + 1 + x * 4);
      }
    return deflateSync(raw, { level: 9 });
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const u32 = (...ns) => Buffer.concat(ns.map((n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  }));
  const animated = frames.length > 1;
  const chunks = [chunk("IHDR", Buffer.concat([u32(w, h), Buffer.from([8, 6, 0, 0, 0])]))];
  if (animated) chunks.push(chunk("acTL", u32(frames.length, 0)));
  let seq = 0;
  frames.forEach((L, i) => {
    if (animated) {
      const timing = Buffer.alloc(6);
      timing.writeUInt16BE(delay, 0);
      timing.writeUInt16BE(1000, 2);
      chunks.push(chunk("fcTL", Buffer.concat([u32(seq++, w, h, 0, 0), timing])));
    }
    chunks.push(i === 0 ? chunk("IDAT", pack(L)) : chunk("fdAT", Buffer.concat([u32(seq++), pack(L)])));
  });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, chunk("IEND", Buffer.alloc(0))]);
}
