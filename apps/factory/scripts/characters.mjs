#!/usr/bin/env node
// Draws the factory's cast as sprite sheets into assets/characters; byte-identical on every run.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRASS, GLASS, GOLD, INK, IRON, PAPER, RED, SHADE, SIZE, STEEL, WHITE, WOOD,
  arm, ball, blit, box, crt, disc, erase, eye, fill, glass, hex, layer, line, mouth, part,
  path as stroke, png, poly, put, ramp, ring, rng, seam, shade, teeth, text, tread, vent, wheel,
} from "./pixel-kit.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/characters");

const FRAMES = 8;
const STATES = ["idle", "active"];
const BOB = { idle: [0, 0, 1, 1, 1, 1, 0, 0], active: [0, -1, -2, -2, -1, 0, 1, 0] };
const HOP = [0, -1, -2, -3, -3, -2, -1, 0];

const CYAN = hex("#45e4ff");
const ORANGE = hex("#ff7a1c");
const LEMON = hex("#ffe03a");
const MINT = hex("#5cf0a0");
const GREEN = ramp("#1d6b2c", "#2f9a40", "#58c95c", "#a4f09a");
const LENS = ramp("#0b2329", "#10363f", "#164c58", "#1d6573", "#27808f");
const LAMP = ramp("#a8480c", "#e0701a", "#ff9a2e", "#ffd27a");

// The shoulder rides the body, the hand its own offset, the elbow splits the two.
const limb = (M, [s, e, h], grip, body, hand) =>
  arm(M, [[s[0], s[1] + body], [e[0], e[1] + Math.round((body + hand) / 2)], [h[0], h[1] + hand]], grip);

function locate(M, { f, active, bob, blink }) {
  const beam = disc(-40, 67, 62);
  if (active)
    for (let y = 44; y < 92; y++)
      for (let x = 1; x < 16; x++) {
        const spread = 4 + (16 - x) * 1.25;
        if (Math.abs(y - 67 - (16 - x) * 0.25) < spread && beam(x, y))
          if (x > 6 || (x + y) & 1) put(M, x, y + bob, [255, 226, 120, (70 + x * 6) * (f & 1 ? 0.75 : 1)]);
      }
  part(M, (L) => {
    stroke(L, [[62, 92 + bob], [70, 105], [78, 92 + bob]], IRON[3], 2);
    wheel(L, 70, 105, 8, active ? f : 0);
  });
  part(M, (L) => {
    line(L, 70, 42, 70, 30, IRON[3], 2);
    const bowl = (x, y) => disc(72, 22, 17)(x, y) && ((y - 22) / 9) ** 2 + ((x - 72) / 17) ** 2 <= 1;
    shade(L, [55, 13, 89, 31], (x, y) => bowl(x, y) && y >= 20 - (x - 72) * 0.25, STEEL);
    line(L, 71, 21, 68, 8, IRON[4]);
    ball(L, 68, 7, 1, active && f % 4 > 1 ? IRON : RED);
  }, 0, bob);
  part(M, (L) => stroke(L, [[47, 42], [47, 37], [58, 37], [58, 42]], IRON[3], 2), 0, bob);
  part(M, (L) => {
    box(L, 42, 42, 56, 51, 5, STEEL);
    ball(L, 64, 64, 15, IRON, 0.5);
    if (blink) {
      shade(L, [51, 51, 77, 77], disc(64, 64, 13), STEEL, 0.6);
      fill(L, 53, 64, 23, 1, INK);
    } else {
      const a = active ? (f / FRAMES) * 2 * Math.PI - 0.6 : -0.6;
      glass(L, [52, 52, 76, 76], disc(64, 64, 12), LENS);
      ring(L, 64, 64, 7, LENS[4], 0.6);
      line(L, 64, 64, Math.round(64 + Math.cos(a) * 10), Math.round(64 + Math.sin(a) * 10), CYAN);
      put(L, 58, 69, CYAN);
      eye(L, 64, 64, 2, CYAN);
      shade(L, [51, 51, 77, 58], (x, y) => disc(64, 64, 13)(x, y) && y <= 58, STEEL, 0.7);
      shade(L, [51, 72, 77, 77], (x, y) => disc(64, 64, 13)(x, y) && y >= 72, STEEL, 0.5);
      fill(L, 53, 59, 23, 1, INK);
    }
    ball(L, 89, 52, 3, IRON, 0.7);
    ball(L, 89, 62, 3, IRON, 0.7);
    mouth(L, [[57, 83], [60, 85], [68, 85], [71, 83]]);
  }, 0, bob);
  part(M, (L) => {
    line(L, 31, 66, 23, 68, IRON[2], 4);
    poly(L, [[15, 62], [23, 64], [23, 71], [15, 74]], STEEL);
    fill(L, 14, 63, 2, 11, active ? hex("#fff0b0") : GLASS[3]);
  }, 0, bob);
  limb(M, [[42, 68], [34, 78], [28, 68]], [-1, 0], bob, bob);
  const pin = bob + (active ? HOP[f] : 0);
  part(M, (L) => {
    ball(L, 110, 46, 6, RED, 0.7);
    poly(L, [[105, 49], [116, 49], [111, 60], [110, 60]], RED, 0.45);
    ball(L, 110, 46, 2, PAPER, 0.9);
  }, 0, pin);
  limb(M, [[97, 68], [108, 76], [110, 65]], [0, -1], bob, pin);
}

function implementer(M, { f, active, bob, blink, rand }) {
  part(M, (L) => {
    tread(L, 27, 97, 27, 16, active ? f : 0);
    tread(L, 67, 97, 27, 16, active ? f : 0);
  });
  part(M, (L) => {
    box(L, 24, 90, 72, 11, 2, STEEL, 0.5);
    seam(L, 47, 91, 47, 99);
    seam(L, 72, 91, 72, 99);
  });
  part(M, (L) => {
    box(L, 22, 27, 76, 65, 5, STEEL);
    crt(L, 31, 35, 58, 45, 7);
    eye(L, 47, 52, 3, ORANGE, blink);
    eye(L, 73, 52, 3, ORANGE, blink);
    teeth(L, 44, 64, 32, 8, 3);
    fill(L, 86, 84, 4, 2, RED[3]);
  }, 0, bob);
  part(M, (L) => {
    poly(L, [[29, 30], [35, 12], [85, 12], [91, 30]], IRON, 0.75);
    fill(L, 44, 16, 32, 8, hex("#0f2b27"));
    line(L, 47, 22, 52, 17, hex("#3f8f7f"));
    ball(L, 32, 27, 2, BRASS, 0.7);
    ball(L, 88, 27, 2, BRASS, 0.7);
  }, 0, bob);
  const wave = bob + (active ? [0, -2, -4, -2, 0, -2, -4, -2][f] : 0);
  part(M, (L) => {
    line(L, 9, 60, 9, 34, STEEL[3], 3);
    line(L, 8, 60, 8, 34, STEEL[5]);
    box(L, 4, 24, 11, 11, 3, STEEL, 0.7);
    erase(L, 8, 24, 3, 6);
    ball(L, 9, 62, 3, STEEL, 0.6);
  }, 0, wave);
  limb(M, [[22, 64], [13, 73], [9, 54]], [0, -1], bob, wave);
  part(M, (L) => {
    line(L, 110, 64, 110, 48, IRON[2], 3);
    line(L, 109, 64, 109, 48, IRON[4]);
    line(L, 109, 46, 104, 41, BRASS[2], 2);
  }, 0, bob);
  limb(M, [[98, 64], [106, 73], [110, 57]], [0, -1], bob, bob);
  if (!active) return;
  const reach = f & 1 ? 5 : 6;
  line(M, 102, 39 + bob, 102 - reach, 39 - reach + bob, hex("#4fb4ff"), 2);
  line(M, 102, 39 + bob, 98, 35 + bob, hex("#bfeaff"), 2);
  line(M, 102, 39 + bob, 100, 37 + bob, WHITE);
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (0.85 + rand() * 0.9);
    const d = 3 + rand() * 11;
    put(M, Math.round(96 + Math.cos(a) * d), Math.round(33 + bob + Math.sin(a) * d), i % 3 ? LEMON : ORANGE);
  }
}

function verify(M, { f, active, bob, blink }) {
  const done = active ? [0, 1, 1, 2, 2, 3, 3, 3][f] : 0;
  part(M, (L) => {
    box(L, 41, 104, 13, 9, 2, IRON);
    box(L, 66, 104, 13, 9, 2, IRON);
  });
  part(M, (L) => {
    line(L, 60, 38, 60, 31, IRON[3], 2);
    ball(L, 60, 27, 3, active && f % 4 < 2 ? GREEN : IRON, 0.8);
  }, 0, bob);
  part(M, (L) => {
    box(L, 32, 38, 56, 68, 8, STEEL);
    crt(L, 38, 45, 44, 32, 6);
    eye(L, 52, 58, 3, LEMON, blink);
    eye(L, 68, 58, 3, LEMON, blink);
    mouth(L, [[53, 66], [56, 68], [64, 68], [67, 66]]);
    for (let i = 0; i < 3; i++) fill(L, 47 + i * 10, 87, 6, 3, i < done ? GREEN[2] : IRON[1]);
  }, 0, bob);
  part(M, (L) => {
    box(L, 3, 60, 21, 29, 1, WOOD);
    fill(L, 5, 65, 17, 22, PAPER[2]);
    box(L, 9, 58, 9, 5, 1, BRASS);
    [69, 75, 81].forEach((y, i) => {
      if (i < done) stroke(L, [[7, y], [8, y + 1], [10, y - 1]], GREEN[1]);
      else fill(L, 7, y, 3, 1, PAPER[0]);
      fill(L, 12, y, 6 + ((i * 3) % 4), 1, PAPER[0]);
    });
  }, 0, bob);
  limb(M, [[32, 74], [26, 84], [23, 77]], [-1, 0], bob, bob);
  const press = bob + (active ? [-5, -5, -2, 1, 2, 1, -2, -5][f] : 0);
  part(M, (L) => {
    box(L, 102, 58, 5, 9, 1, WOOD, 0.7);
    box(L, 95, 66, 19, 6, 1, IRON, 0.7);
    fill(L, 96, 72, 17, 1, GREEN[2]);
  }, 0, press);
  limb(M, [[87, 72], [99, 64], [104, 56]], [0, 1], bob, press);
  if (done === 3) part(M, (L) => stroke(L, [[99, 86], [103, 90], [111, 81]], GREEN[2], 2));
}

function deliver(M, { f, active, bob, blink }) {
  if (active)
    for (const [x, y, a] of [[106, 52, 170], [108, 49, 140], [107, 45, 110], [110, 42, 80], [109, 38, 50]])
      fill(M, x, y - (f % 4) + bob, 3, 3, [120, 126, 128, a - (f % 4) * 12]);
  part(M, (L) => {
    line(L, 104, 70, 104, 57, IRON[2], 3);
    fill(L, 102, 56, 5, 2, IRON[4]);
  }, 0, bob);
  part(M, (L) => {
    box(L, 25, 17, 3, 84, 1, IRON, 0.8);
    box(L, 30, 17, 3, 84, 1, IRON, 0.8);
    for (const y of [20, 42, 64]) fill(L, 25, y, 8, 2, IRON[2]);
  });
  part(M, (L) => {
    box(L, 50, 33, 52, 39, 5, STEEL);
    crt(L, 55, 38, 42, 27, 5);
    eye(L, 68, 51, 3, MINT, blink);
    eye(L, 84, 51, 3, MINT, blink);
    for (const x of [63, 79]) {
      fill(L, x, 46, 11, 3, GLASS[2]);
      fill(L, x, 48, 11, 1, SHADE);
    }
    mouth(L, [[68, 58], [71, 60], [81, 60], [84, 58]]);
  }, 0, bob);
  const flash = active && f % 4 < 2;
  part(M, (L) => {
    fill(L, 71, 31, 11, 2, IRON[2]);
    ball(L, 76, 27, 4, flash ? LAMP : LAMP.slice(0, 2), 0.8);
  }, 0, bob);
  if (flash) for (const [x, y] of [[68, 24], [84, 24], [70, 19], [82, 19], [76, 17]]) put(M, x, y + bob, ORANGE);
  part(M, (L) => {
    box(L, 33, 68, 75, 30, 4, STEEL, 0.6);
    for (let y = 85; y < 91; y++)
      for (let x = 35; x < 106; x++) put(L, x, y, ((x + y + (active ? f : 0)) >> 2) & 1 ? GOLD[2] : IRON[0]);
    fill(L, 35, 72, 3, 5, hex("#fff0b0"));
    seam(L, 92, 70, 92, 83);
    vent(L, 96, 73, 8, 3);
  }, 0, bob);
  part(M, (L) => {
    wheel(L, 46, 104, 8, active ? f : 0);
    wheel(L, 90, 102, 10, active ? f : 0);
  });
  const lift = active ? HOP[f] * 2 : 0;
  part(M, (L) => {
    box(L, 22, 78, 13, 13, 1, IRON, 0.75);
    box(L, 2, 88, 24, 3, 1, STEEL, 0.8);
  }, 0, lift);
  part(M, (L) => {
    box(L, 3, 65, 20, 23, 1, WOOD, 0.75);
    fill(L, 4, 72, 18, 1, WOOD[0]);
    fill(L, 4, 80, 18, 1, WOOD[0]);
    fill(L, 9, 69, 1, 16, INK);
    line(L, 9, 80, 15, 74, INK);
    for (const [x, y] of [[8, 68], [8, 84], [15, 72]]) fill(L, x, y, 3, 3, INK);
  }, 0, lift);
}

const cast = { locate, implementer, verify, deliver };

const sprites = Object.entries(cast).map(([role, draw], i) => ({
  role,
  frames: STATES.map((state) =>
    Array.from({ length: FRAMES }, (_, f) => {
      const sprite = layer();
      const active = state === "active";
      draw(sprite, { f, active, bob: BOB[state][f], blink: !active && f === 5, rand: rng(i * 7919 + f * 131 + 17) });
      return sprite;
    }),
  ),
}));

mkdirSync(out, { recursive: true });
for (const { role, frames } of sprites) {
  const sheet = layer(SIZE * FRAMES, SIZE * STATES.length);
  frames.forEach((row, s) => row.forEach((sprite, f) => blit(sheet, sprite, f * SIZE, s * SIZE)));
  writeFileSync(path.join(out, `${role}.png`), png([sheet], 1));
}

const cell = SIZE + 8;
const gutter = 30;
const preview = Array.from({ length: FRAMES }, (_, f) => {
  const sheet = layer(gutter + cell * sprites.length, cell * STATES.length + 12);
  fill(sheet, 0, 0, sheet.w, sheet.h, hex("#efece4"));
  STATES.forEach((state, s) => text(sheet, state, gutter / 2 + 2, s * cell + SIZE / 2, INK, 1));
  sprites.forEach(({ role, frames }, i) => {
    STATES.forEach((_, s) => blit(sheet, frames[s][f], gutter + i * cell + 4, s * cell + 4));
    text(sheet, role, gutter + i * cell + cell / 2, cell * STATES.length + 2, INK, 1);
  });
  return sheet;
});
writeFileSync(path.join(out, "cast.png"), png(preview, 2));
