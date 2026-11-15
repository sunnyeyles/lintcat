#!/usr/bin/env node
// Draws the factory's cast into assets/characters; byte-identical on every run.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLUE, BRASS, GLASS, GOLD, INK, IRON, PAPER, RED, SHADE, SIZE, STEEL, WHITE, WOOD,
  arm, ball, blit, box, brow, cable, crt, disc, erase, eye, fill, glass, hex, layer, line, mix,
  mouth, part, path as stroke, png, poly, put, ramp, ring, rivet, rng, rust, seam, shade, teeth,
  text, tread, vent, wheel,
} from "./pixel-kit.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/characters");

const AMBER = hex("#ffae2b");
const CYAN = hex("#45e4ff");
const AZURE = hex("#4aa3ff");
const LIME = hex("#58f56c");
const ORANGE = hex("#ff7a1c");
const LEMON = hex("#ffe03a");
const VIOLET = hex("#b587ff");
const MINT = hex("#5cf0a0");
const GREEN = ramp("#1d6b2c", "#2f9a40", "#58c95c", "#a4f09a");
const JAR = ramp("#13231c", "#1c3529", "#274b3a", "#35634d", "#478061");
const LENS = ramp("#0b2329", "#10363f", "#164c58", "#1d6573", "#27808f");
const VIAL = ramp("#5f8f93", "#86b5b8", "#a9d3d4", "#cfeeee");

const rivets = (L, pts) => pts.forEach(([x, y]) => rivet(L, x, y));

function discovery(M, rand) {
  part(M, (L) => {
    box(L, 46, 5, 28, 30, 1, PAPER, 0.95);
    for (let y = 10; y < 30; y += 4) fill(L, 49, y, 10 + Math.floor(rand() * 12), 1, PAPER[0]);
  });
  part(M, (L) => {
    box(L, 28, 104, 13, 9, 2, IRON);
    box(L, 79, 104, 13, 9, 2, IRON);
  });
  part(M, (L) => {
    box(L, 28, 30, 64, 53, 5, STEEL);
    rust(L, rand, [28, 30, 91, 82], 9);
    fill(L, 43, 31, 34, 2, INK);
    crt(L, 35, 38, 50, 34, 6);
    eye(L, 50, 54, 3, AMBER);
    eye(L, 70, 54, 3, AMBER);
    stroke(L, [[44, 46], [49, 43], [55, 45]], SHADE, 2);
    brow(L, 65, 48, 75, 48);
    mouth(L, [[54, 64], [61, 65], [66, 63]]);
    rivets(L, [[31, 33], [87, 33], [31, 77], [87, 77]]);
    fill(L, 80, 76, 4, 2, AMBER);
  });
  part(M, (L) => {
    poly(L, [[24, 80], [96, 80], [104, 105], [16, 105]], STEEL, 0.6);
    rust(L, rand, [17, 81, 103, 104], 6);
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 11 + r; k++) {
        fill(L, 27 - r * 3 + k * 6, 84 + r * 6, 4, 3, PAPER[2]);
        fill(L, 27 - r * 3 + k * 6, 87 + r * 6, 4, 1, PAPER[0]);
      }
  });
  part(M, (L) => {
    box(L, 3, 52, 20, 31, 1, WOOD);
    fill(L, 5, 57, 16, 24, PAPER[2]);
    box(L, 9, 50, 8, 5, 1, BRASS);
    for (let y = 60; y < 80; y += 4) {
      fill(L, 7, y, 2, 2, IRON[2]);
      fill(L, 11, y, 5 + Math.floor(rand() * 4), 1, PAPER[0]);
    }
  });
  arm(M, [[28, 66], [20, 77], [17, 70]], [-1, 0]);
  part(M, (L) => {
    line(L, 107, 62, 112, 38, GOLD[2], 3);
    line(L, 106, 62, 111, 38, GOLD[3]);
    fill(L, 106, 63, 3, 2, STEEL[4]);
    fill(L, 106, 65, 3, 3, hex("#e58a94"));
    fill(L, 111, 35, 3, 3, PAPER[1]);
    fill(L, 112, 33, 2, 2, INK);
  });
  arm(M, [[92, 66], [104, 75], [108, 58]], [0, -1]);
}

function locate(M) {
  const beam = disc(-40, 67, 62);
  for (let y = 44; y < 92; y++)
    for (let x = 1; x < 16; x++) {
      const spread = 4 + (16 - x) * 1.25;
      if (Math.abs(y - 67 - (16 - x) * 0.25) < spread && beam(x, y))
        if (x > 6 || (x + y) & 1) put(M, x, y, [255, 226, 120, 70 + x * 6]);
    }
  part(M, (L) => {
    stroke(L, [[62, 92], [70, 105], [78, 92]], IRON[3], 2);
    wheel(L, 70, 105, 8);
  });
  part(M, (L) => {
    line(L, 70, 42, 70, 30, IRON[3], 2);
    const bowl = (x, y) => disc(72, 22, 17)(x, y) && ((y - 22) / 9) ** 2 + ((x - 72) / 17) ** 2 <= 1;
    shade(L, [55, 13, 89, 31], (x, y) => bowl(x, y) && y >= 20 - (x - 72) * 0.25, STEEL);
    line(L, 71, 21, 68, 8, IRON[4]);
    ball(L, 68, 7, 1, RED);
  });
  part(M, (L) => stroke(L, [[47, 42], [47, 37], [58, 37], [58, 42]], IRON[3], 2));
  part(M, (L) => {
    box(L, 42, 42, 56, 51, 5, STEEL);
    rust(L, rand(locate), [42, 42, 97, 92], 9);
    ball(L, 64, 64, 15, IRON, 0.5);
    glass(L, [52, 52, 76, 76], disc(64, 64, 12), LENS);
    ring(L, 64, 64, 7, LENS[4], 0.6);
    line(L, 64, 64, 73, 58, CYAN);
    put(L, 58, 69, CYAN);
    eye(L, 64, 64, 2, CYAN);
    shade(L, [51, 51, 77, 58], (x, y) => disc(64, 64, 13)(x, y) && y <= 58, STEEL, 0.7);
    shade(L, [51, 72, 77, 77], (x, y) => disc(64, 64, 13)(x, y) && y >= 72, STEEL, 0.5);
    fill(L, 53, 59, 23, 1, INK);
    ball(L, 89, 52, 3, IRON, 0.7);
    ball(L, 89, 62, 3, IRON, 0.7);
    put(L, 89, 50, RED[3]);
    put(L, 91, 62, RED[3]);
    vent(L, 85, 71, 9, 3);
    vent(L, 56, 84, 16, 2);
    rivets(L, [[45, 45], [93, 45], [45, 88], [93, 88]]);
  });
  part(M, (L) => {
    line(L, 31, 66, 23, 68, IRON[2], 4);
    poly(L, [[15, 62], [23, 64], [23, 71], [15, 74]], STEEL);
    fill(L, 14, 63, 2, 11, hex("#fff0b0"));
    fill(L, 26, 64, 2, 1, RED[2]);
  });
  arm(M, [[42, 68], [34, 78], [28, 68]], [-1, 0]);
  part(M, (L) => {
    ball(L, 110, 46, 6, RED, 0.7);
    poly(L, [[105, 49], [116, 49], [111, 60], [110, 60]], RED, 0.45);
    ball(L, 110, 46, 2, PAPER, 0.9);
  });
  arm(M, [[97, 68], [108, 76], [110, 65]], [0, -1]);
}

function architect(M, rand) {
  part(M, (L) => {
    for (const x of [34, 62, 90]) {
      line(L, 62, 86, x, 111, IRON[3], 2);
      fill(L, x - 3, 111, 8, 2, IRON[2]);
    }
    ball(L, 62, 86, 4, IRON, 0.7);
  });
  part(M, (L) => {
    box(L, 22, 37, 82, 7, 1, IRON, 0.7);
    for (let x = 25; x < 102; x += 4) fill(L, x, 39, 1, x % 8 === 1 ? 3 : 2, PAPER[2]);
  });
  part(M, (L) => {
    box(L, 24, 43, 78, 41, 4, STEEL);
    rust(L, rand, [24, 43, 101, 83], 10);
    crt(L, 29, 49, 48, 30, 5);
    eye(L, 44, 62, 2, AZURE);
    eye(L, 61, 62, 2, AZURE);
    for (const x of [38, 55]) {
      fill(L, x, 57, 13, 2, SHADE);
      fill(L, x, 67, 13, 1, SHADE);
      fill(L, x, 57, 1, 11, SHADE);
      fill(L, x + 12, 57, 1, 11, SHADE);
    }
    fill(L, 51, 60, 4, 1, SHADE);
    fill(L, 47, 72, 12, 2, SHADE);
    put(L, 46, 73, SHADE);
    put(L, 59, 73, SHADE);
    ball(L, 89, 54, 3, BRASS, 0.7);
    ball(L, 89, 64, 3, BRASS, 0.7);
    for (let x = 82; x < 98; x += 2) fill(L, x, 73, 1, x % 4 ? 3 : 5, IRON[1]);
    fill(L, 82, 79, 4, 2, AZURE);
    rivets(L, [[26, 45], [98, 45], [26, 80], [98, 80]]);
  });
  part(M, (L) => {
    box(L, 72, 32, 11, 15, 1, STEEL, 0.75);
    fill(L, 76, 36, 3, 6, BLUE[2]);
    put(L, 77, 44, INK);
  });
  part(M, (L) => {
    box(L, 2, 30, 19, 34, 1, BLUE, 0.75);
    const chalk = BLUE[3];
    for (const [x, y, w, h] of [[5, 35, 13, 1], [5, 47, 13, 1], [5, 35, 1, 13], [17, 35, 1, 13]])
      fill(L, x, y, w, h, chalk);
    fill(L, 11, 35, 1, 7, chalk);
    fill(L, 11, 41, 6, 1, chalk);
    line(L, 5, 52, 17, 52, chalk);
    line(L, 5, 56, 12, 56, chalk);
    box(L, 1, 62, 21, 8, 3, BLUE, 0.6);
    fill(L, 1, 64, 2, 4, PAPER[3]);
    fill(L, 20, 64, 2, 4, PAPER[1]);
  });
  arm(M, [[24, 64], [15, 80], [11, 73]], [0, -1]);
  part(M, (L) => {
    line(L, 110, 56, 105, 80, STEEL[4], 2);
    line(L, 111, 56, 116, 80, STEEL[3], 2);
    fill(L, 105, 81, 1, 3, INK);
    fill(L, 116, 81, 2, 3, BLUE[2]);
    ball(L, 110, 55, 2, BRASS, 0.7);
  });
  arm(M, [[101, 62], [112, 58], [110, 47]], [0, 1]);
}

function reproduce(M, rand) {
  const mesh = (x, y) => (x + y) % 3 === 0 || (x - y + 60) % 3 === 0;
  for (let y = 22; y < 44; y++)
    for (let x = 2; x < 26; x++) {
      const half = 11 - (y - 22) * 0.32;
      if (Math.abs(x - 13) < half && mesh(x, y)) put(M, x, y, STEEL[3]);
    }
  part(M, (L) => {
    stroke(L, [[48, 90], [44, 96], [50, 101], [44, 106], [46, 111]], IRON[3], 2);
    stroke(L, [[72, 90], [76, 96], [70, 101], [76, 106], [74, 111]], IRON[3], 2);
    fill(L, 41, 111, 11, 2, IRON[2]);
    fill(L, 69, 111, 11, 2, IRON[2]);
  });
  part(M, (L) => ring(L, 60, 10, 4, BRASS[2], 1));
  part(M, (L) => {
    poly(L, [[38, 29], [46, 15], [74, 15], [82, 29]], STEEL, 0.55);
    rust(L, rand, [40, 16, 80, 28], 5);
  });
  part(M, (L) => {
    crt(L, 36, 28, 48, 51, 4, JAR);
    fill(L, 41, 30, 2, 47, IRON[3]);
    fill(L, 77, 30, 2, 47, IRON[3]);
    eye(L, 52, 48, 4, LIME);
    eye(L, 70, 49, 2, LIME);
    brow(L, 46, 39, 56, 41);
    const grin = [[46, 62], [50, 66], [54, 62], [58, 66], [62, 62], [66, 66], [70, 62], [74, 66]];
    stroke(L, grin.map(([x, y]) => [x, y + 1]), JAR[0]);
    stroke(L, grin, mix(LIME, WHITE, 0.6));
  });
  part(M, (L) => {
    box(L, 33, 78, 54, 14, 3, STEEL, 0.6);
    rust(L, rand, [33, 78, 86, 91], 6);
    fill(L, 44, 85, 32, 2, INK);
    rivets(L, [[36, 81], [82, 81]]);
  });
  for (const [sx, dir] of [[30, 1], [89, -1]])
    stroke(M, [[sx, 36], [sx + 2 * dir, 39], [sx - dir, 42], [sx + 2 * dir, 46]], LEMON);
  part(M, (L) => {
    line(L, 19, 60, 14, 26, WOOD[2], 2);
    for (let a = 0; a < 64; a++)
      fill(L, Math.round(13 + 11 * Math.cos(a / 10.2)), Math.round(20 + 5 * Math.sin(a / 10.2)), 2, 2, BRASS[2]);
  });
  arm(M, [[36, 60], [25, 70], [19, 58]], [0, -1]);
  part(M, (L) => {
    box(L, 94, 33, 18, 26, 3, VIAL, 0.8);
    box(L, 95, 29, 16, 5, 1, BRASS, 0.7);
    fill(L, 101, 45, 5, 6, RED[2]);
    fill(L, 103, 45, 1, 6, RED[0]);
    fill(L, 102, 43, 3, 2, INK);
    for (const y of [45, 48, 51]) {
      fill(L, 99, y, 2, 1, INK);
      fill(L, 106, y, 2, 1, INK);
    }
    line(L, 97, 37, 97, 44, WHITE);
  });
  arm(M, [[84, 60], [96, 70], [103, 63]], [0, -1]);
}

function implementer(M, rand) {
  cable(M, [[24, 84], [13, 90], [9, 101], [3, 105]]);
  part(M, (L) => {
    tread(L, 27, 97, 27, 16);
    tread(L, 67, 97, 27, 16);
  });
  part(M, (L) => {
    box(L, 22, 27, 76, 65, 5, STEEL);
    rust(L, rand, [22, 27, 97, 91], 13);
    crt(L, 31, 35, 58, 45, 7);
    eye(L, 47, 52, 3, ORANGE);
    eye(L, 73, 52, 4, ORANGE);
    brow(L, 41, 43, 52, 46);
    brow(L, 79, 42, 67, 45);
    teeth(L, 44, 64, 32, 8, 3);
    rivets(L, [[25, 30], [93, 30], [25, 87], [93, 87]]);
    fill(L, 86, 84, 4, 2, RED[3]);
    vent(L, 26, 60, 3, 5);
  });
  part(M, (L) => {
    box(L, 24, 90, 72, 11, 2, STEEL, 0.5);
    rust(L, rand, [24, 90, 95, 100], 5);
    seam(L, 47, 91, 47, 99);
    seam(L, 72, 91, 72, 99);
  });
  part(M, (L) => {
    poly(L, [[29, 30], [35, 12], [85, 12], [91, 30]], IRON, 0.75);
    fill(L, 44, 16, 32, 8, hex("#0f2b27"));
    line(L, 47, 22, 52, 17, hex("#3f8f7f"));
    line(L, 51, 22, 54, 19, hex("#2a6b5e"));
    ball(L, 32, 27, 2, BRASS, 0.7);
    ball(L, 88, 27, 2, BRASS, 0.7);
  });
  part(M, (L) => {
    line(L, 9, 60, 9, 34, STEEL[3], 3);
    line(L, 8, 60, 8, 34, STEEL[5]);
    box(L, 4, 24, 11, 11, 3, STEEL, 0.7);
    erase(L, 8, 24, 3, 6);
    ball(L, 9, 62, 3, STEEL, 0.6);
    put(L, 9, 62, INK);
  });
  arm(M, [[22, 64], [13, 73], [9, 54]], [0, -1]);
  part(M, (L) => {
    line(L, 110, 64, 110, 48, IRON[2], 3);
    line(L, 109, 64, 109, 48, IRON[4]);
    line(L, 109, 46, 104, 41, BRASS[2], 2);
  });
  arm(M, [[98, 64], [106, 73], [110, 57]], [0, -1]);
  line(M, 102, 39, 96, 33, hex("#4fb4ff"), 2);
  line(M, 102, 39, 98, 35, hex("#bfeaff"), 2);
  line(M, 102, 39, 100, 37, WHITE);
  for (let i = 0; i < 22; i++) {
    const a = Math.PI * (0.85 + rand() * 0.9);
    const d = 3 + rand() * 11;
    put(M, Math.round(96 + Math.cos(a) * d), Math.round(33 + Math.sin(a) * d), i % 3 ? LEMON : ORANGE);
  }
}

function verify(M, rand) {
  part(M, (L) => {
    box(L, 39, 104, 13, 9, 2, IRON);
    box(L, 68, 104, 13, 9, 2, IRON);
  });
  part(M, (L) => {
    box(L, 34, 48, 52, 58, 8, STEEL);
    rust(L, rand, [34, 56, 85, 105], 11);
    for (const y of [64, 94]) {
      fill(L, 34, y, 52, 3, IRON[3]);
      fill(L, 34, y, 52, 1, IRON[4]);
      for (let x = 38; x < 84; x += 6) put(L, x, y + 1, STEEL[5]);
    }
    ball(L, 60, 79, 9, BRASS, 0.7);
    ball(L, 60, 79, 7, PAPER, 0.95);
    for (const [x, y] of [[54, 78], [55, 75], [58, 73]]) put(L, x, y, IRON[1]);
    for (const [x, y] of [[62, 73], [65, 75], [66, 78]]) put(L, x, y, RED[2]);
    line(L, 60, 80, 64, 75, RED[1]);
    put(L, 60, 80, INK);
    box(L, 84, 58, 6, 5, 1, BRASS, 0.7);
  });
  for (const [x, y, a] of [[90, 54, 200], [91, 52, 200], [92, 50, 170], [91, 48, 150], [93, 47, 150], [92, 45, 110], [94, 43, 80]])
    fill(M, x, y, 2, 2, [176, 190, 196, a]);
  part(M, (L) => {
    ball(L, 60, 31, 22, BRASS, 0.7);
    ball(L, 60, 31, 19, IRON, 0.4);
    glass(L, [42, 13, 78, 49], disc(60, 31, 18));
    for (let deg = 200; deg <= 340; deg += 20) {
      const a = (deg * Math.PI) / 180;
      const at = (r) => [Math.round(60 + Math.cos(a) * r), Math.round(31 + Math.sin(a) * r)];
      line(L, ...at(14), ...at(17), deg > 300 ? RED[2] : PAPER[3]);
    }
    eye(L, 52, 31, 3, LEMON);
    eye(L, 68, 31, 3, LEMON);
    brow(L, 46, 24, 56, 26);
    brow(L, 74, 24, 64, 26);
    fill(L, 54, 41, 13, 2, SHADE);
    put(L, 53, 42, SHADE);
    put(L, 53, 43, SHADE);
    put(L, 67, 42, SHADE);
    put(L, 67, 43, SHADE);
    line(L, 47, 20, 51, 16, mix(GLASS[5], WHITE, 0.45));
  });
  part(M, (L) => {
    box(L, 3, 60, 21, 29, 1, WOOD);
    fill(L, 5, 65, 17, 22, PAPER[2]);
    box(L, 9, 58, 9, 5, 1, BRASS);
    [68, 73, 78, 83].forEach((y, i) => {
      const ok = i !== 2;
      stroke(L, ok ? [[7, y], [8, y + 1], [10, y - 1]] : [[7, y - 1], [9, y + 1]], ok ? GREEN[1] : RED[1]);
      if (!ok) line(L, 9, y - 1, 7, y + 1, RED[1]);
      fill(L, 12, y, 6 + ((i * 3) % 4), 1, PAPER[0]);
    });
  });
  arm(M, [[34, 74], [27, 84], [23, 77]], [-1, 0]);
  part(M, (L) => {
    box(L, 102, 58, 5, 9, 1, WOOD, 0.7);
    box(L, 95, 66, 19, 6, 1, IRON, 0.7);
    fill(L, 96, 72, 17, 1, GREEN[2]);
  });
  arm(M, [[86, 72], [99, 64], [104, 56]], [0, 1]);
  part(M, (L) => stroke(L, [[99, 84], [103, 88], [111, 79]], GREEN[2], 2));
}

function reviewer(M, rand) {
  part(M, (L) => {
    stroke(L, [[52, 86], [50, 98], [52, 110]], IRON[3], 2);
    stroke(L, [[68, 86], [70, 98], [68, 110]], IRON[3], 2);
    ball(L, 50, 98, 2, STEEL, 0.6);
    ball(L, 70, 98, 2, STEEL, 0.6);
    box(L, 44, 109, 11, 4, 1, IRON, 0.7);
    box(L, 66, 109, 11, 4, 1, IRON, 0.7);
  });
  part(M, (L) => {
    box(L, 36, 9, 48, 79, 5, STEEL);
    rust(L, rand, [36, 9, 83, 87], 12);
    crt(L, 41, 14, 38, 49, 5);
    eye(L, 51, 35, 2, VIOLET);
    eye(L, 68, 34, 3, VIOLET);
    ring(L, 68, 34, 7, BRASS[3], 0.9);
    ring(L, 68, 34, 8, BRASS[1], 0.5);
    for (let i = 0; i < 12; i += 2) put(L, 75 + Math.round(i * 0.25), 38 + i * 2, BRASS[3]);
    brow(L, 46, 30, 55, 31);
    brow(L, 62, 22, 73, 21);
    mouth(L, [[51, 51], [60, 51], [66, 48]]);
    fill(L, 52, 69, 26, 2, INK);
    fill(L, 52, 71, 26, 1, STEEL[4]);
    fill(L, 42, 68, 5, 4, VIOLET);
    vent(L, 44, 77, 32, 3);
    rivets(L, [[39, 12], [79, 12], [39, 83], [79, 83]]);
  });
  arm(M, [[36, 54], [23, 63], [31, 74]], [1, 0]);
  part(M, (L) => {
    line(L, 103, 54, 109, 28, RED[2], 3);
    line(L, 102, 54, 108, 28, RED[3]);
    fill(L, 102, 55, 3, 4, IRON[2]);
    fill(L, 108, 24, 3, 3, STEEL[4]);
    fill(L, 109, 21, 2, 3, IRON[1]);
    put(L, 110, 20, RED[2]);
  });
  arm(M, [[83, 52], [97, 63], [103, 49]], [0, -1]);
}

function deliver(M, rand) {
  for (const [x, y, a] of [[106, 52, 170], [108, 49, 140], [107, 45, 110], [110, 42, 80], [109, 38, 50]])
    fill(M, x, y, 3, 3, [120, 126, 128, a]);
  part(M, (L) => {
    line(L, 104, 70, 104, 57, IRON[2], 3);
    fill(L, 102, 56, 5, 2, IRON[4]);
  });
  part(M, (L) => {
    box(L, 25, 17, 3, 84, 1, IRON, 0.8);
    box(L, 30, 17, 3, 84, 1, IRON, 0.8);
    for (const y of [20, 42, 64]) fill(L, 25, y, 8, 2, IRON[2]);
  });
  part(M, (L) => {
    box(L, 50, 33, 52, 39, 5, STEEL);
    rust(L, rand, [50, 33, 101, 71], 8);
    crt(L, 55, 38, 42, 27, 5);
    eye(L, 68, 51, 3, MINT);
    eye(L, 84, 51, 3, MINT);
    for (const x of [63, 79]) {
      fill(L, x, 46, 11, 4, GLASS[2]);
      fill(L, x, 49, 11, 2, SHADE);
    }
    mouth(L, [[66, 59], [75, 61], [84, 58], [86, 56]]);
    rivets(L, [[52, 35], [98, 35]]);
  });
  part(M, (L) => {
    fill(L, 71, 31, 11, 2, IRON[2]);
    ball(L, 76, 27, 4, ramp("#a8480c", "#e0701a", "#ff9a2e", "#ffd27a"), 0.8);
  });
  for (const [x, y] of [[68, 24], [84, 24], [70, 19], [82, 19], [76, 17]]) put(M, x, y, ORANGE);
  part(M, (L) => {
    box(L, 33, 68, 75, 30, 4, STEEL, 0.6);
    rust(L, rand, [33, 68, 107, 97], 9);
    for (let y = 85; y < 91; y++)
      for (let x = 35; x < 106; x++) put(L, x, y, ((x + y) >> 2) & 1 ? GOLD[2] : IRON[0]);
    fill(L, 35, 72, 3, 5, hex("#fff0b0"));
    seam(L, 92, 70, 92, 83);
    vent(L, 96, 73, 8, 3);
    rivets(L, [[42, 71], [86, 71]]);
  });
  part(M, (L) => {
    wheel(L, 46, 104, 8);
    wheel(L, 90, 102, 10);
  });
  part(M, (L) => {
    box(L, 22, 78, 13, 13, 1, IRON, 0.75);
    box(L, 2, 88, 24, 3, 1, STEEL, 0.8);
  });
  part(M, (L) => {
    box(L, 3, 65, 20, 23, 1, WOOD, 0.75);
    fill(L, 4, 72, 18, 1, WOOD[0]);
    fill(L, 4, 80, 18, 1, WOOD[0]);
    fill(L, 9, 69, 1, 16, INK);
    line(L, 9, 80, 15, 74, INK);
    for (const [x, y] of [[8, 68], [8, 84], [15, 72]]) fill(L, x, y, 3, 3, INK);
  });
}

const cast = { discovery, locate, architect, reproduce, implementer, verify, reviewer, deliver };

function rand(draw) {
  return rng(Object.values(cast).indexOf(draw) * 7919 + 17);
}

mkdirSync(out, { recursive: true });
const cell = SIZE + 8;
const sheet = layer(cell * 4, (cell + 14) * 2);
fill(sheet, 0, 0, sheet.w, sheet.h, hex("#efece4"));
Object.entries(cast).forEach(([role, draw], i) => {
  const sprite = layer();
  draw(sprite, rand(draw));
  writeFileSync(path.join(out, `${role}.png`), png(sprite, 4));
  const [x, y] = [(i % 4) * cell, Math.floor(i / 4) * (cell + 14)];
  blit(sheet, sprite, x + 4, y + 4);
  text(sheet, role, x + cell / 2, y + SIZE + 6, INK, 1);
});
writeFileSync(path.join(out, "cast.png"), png(sheet, 3));
