// LINTCAT · HOW A REVIEW WORKS. A pixel-art explainer: a pull request opens, LintCat reads,
// proposes, checks every finding, and posts only what passed. Every claim is sourced in STORYBOARD.md.
import type { Film } from "anidoodle-engine/canvas-core/film";
import type { PixelDraft } from "anidoodle-engine/canvas-core/pixelArtKit";
import { blit } from "anidoodle-engine/canvas-core/pixelArtKit";
import { C, PALETTE } from "./lintcatReviewPalette";
import { Author, CEL, CHECK, CROSS, G, H, MARK_ORDER, MINI_CAT, REST, catRects, checkTimeline, compose, markPart, text, textWidth, type Chapter, type Placement, type Pose, type Rects } from "./lintcatReviewKit";

const FPS = 30, BPM = 120, N = 1050;
const T = { title: 0, opened: 105, read: 210, propose: 390, check: 540, post: 735, payoff: 900 };
const HOLDS: [number, number][] = [[975, N]];

// ---------------------------------------------------------------- layout
const BIG_X = 8, BIG_Y = 3, SUB_Y1 = 3, SUB_Y2 = 11, STRIP_Y = 100;
const STRIP = [["READ", 26], ["PROPOSE", 57], ["CHECK", 106], ["POST", 143]] as const;
const CAT: Placement = { rects: catRects(4), x: 10, y: 60 };
const DIFF = { x: 44, y: 22, w: 55, h: 75, lines: 20, added: [3, 7, 11, 14, 17] };
const CARD_X = 106, CARD_W = 86, CARD_H = 12, cardY = (i: number) => 24 + 12 * i;
const GATE_X = 100, LEAD_X = 103;
const CARDS = [
  { label: "CORRECT", conf: "0.91", line: 3 },
  { label: "SECURITY", conf: "0.88", line: 7 },
  { label: "PERF", conf: "0.83", line: 9 },
  { label: "TESTS", conf: "0.55", line: 11 },
  { label: "DOCS", conf: "0.79", line: 14 },
  { label: "CORRECT", conf: "0.90", line: 3 },
];
const PASS = [0, 1, 4], FAIL: [number, string][] = [[2, "NOT CHANGED"], [3, "UNSURE 0.55"], [5, "DUPLICATE"]];
const WIDTHS = [30, 22, 36, 18, 28, 40, 24, 34, 20, 32, 26, 38, 16, 30, 22, 34, 28, 20, 36, 24];

// ---------------------------------------------------------------- marks
const frame = (d: PixelDraft, x: number, y: number, w: number, h: number, c: number) => { d.rect(x, y, w, 1, c); d.rect(x, y + h - 1, w, 1, c); d.rect(x, y, 1, h, c); d.rect(x + w - 1, y, 1, h, c); };
const panel = (d: PixelDraft, x: number, y: number, w: number, h: number, fill: number, border: number) => { d.rect(x + 1, y + 1, w - 2, h - 2, fill); frame(d, x, y, w, h, border); };
const big = (d: PixelDraft, s: string) => text(d, s, BIG_X, BIG_Y, C.navy, 2);
const subX = (word: string) => BIG_X + textWidth(word, 2) + 10;
const strip = (d: PixelDraft, lit: number) => STRIP.forEach(([w, x], i) => text(d, w, x, STRIP_Y, i < lit ? C.navy : C.stone));
const light = (d: PixelDraft, i: number) => text(d, STRIP[i][0], STRIP[i][1], STRIP_Y, C.navy);
const stamp = (rects: Rects, x: number, y: number): Placement => ({ rects, x, y });
const poseAt = (events: [number, Pose][], cel: number): Pose => events.reduce((p, [at, pose]) => (cel >= at ? pose : p), REST);
const P = (eyes: Pose["eyes"], look: Pose["look"] = 0, whisk: Pose["whisk"] = 0): Pose => ({ eyes, look, whisk });
const blink = (at: number, after: Pose = REST): [number, Pose][] => [[at, P("shut", after.look, after.whisk)], [at + 1, after]];

// A code page: navy frame, slate header with a paper title, one 3-row band per line; added lines sit on mint.
type Page = { x: number; y: number; w: number; h: number; lines: number; added: number[]; skip?: number[] };
const lineY = (p: Page, i: number) => p.y + 13 + i * 3;
const pageFrame = (d: PixelDraft, p: Page) => { panel(d, p.x, p.y, p.w, p.h, C.paper, C.navy); d.rect(p.x + 1, p.y + 1, p.w - 2, 9, C.slate); };
const pageLines = (d: PixelDraft, p: Page) => {
  for (let i = 0; i < p.lines; i++) {
    if (p.skip?.includes(i)) continue;
    const y = lineY(p, i), added = p.added.includes(i);
    if (added) { d.rect(p.x + 1, y, p.w - 2, 3, C.mint); d.rect(p.x + 3, y + 1, 2, 1, C.turquoise); }
    d.rect(p.x + 7, y + 1, Math.min(p.w - 12, WIDTHS[i % WIDTHS.length]), 1, added ? C.navy : C.slate);
  }
};
const underline = (d: PixelDraft, p: Page, i: number) => d.rect(p.x + 7, lineY(p, i) + 2, p.w - 12, 1, C.stone);

// The four reference pages of READ: a slate frame, a label, stone bars that turn navy once read.
const sidePage = (d: PixelDraft, x: number, y: number, label: string) => { panel(d, x, y, 45, 35, C.paper, C.slate); text(d, label, x + 2, y + 2, C.navy); };
const sideBars = (d: PixelDraft, x: number, y: number, c: number, seed: number) => { for (let i = 0; i < 7; i++) d.rect(x + 3, y + 11 + i * 3, WIDTHS[(i + seed) % WIDTHS.length], 1, c); };
const SIDES: [number, number, string][] = [[101, 22, "CONTEXT"], [101, 62, "BEFORE"], [147, 22, "IMPORTS"], [147, 62, "TESTS"]];

// A finding card, and its leader back to the diff line it points at.
const card = (d: PixelDraft, i: number, part: "frame" | "label" | "conf" | "bar" | "leader") => {
  const { label, conf, line } = CARDS[i], x = CARD_X, y = cardY(i);
  if (part === "frame") panel(d, x, y, CARD_W, CARD_H, C.sand, C.navy);
  if (part === "label") text(d, label, x + 2, y + 2, C.navy);
  if (part === "conf") text(d, conf, x + 52, y + 2, C.navy);
  if (part === "bar") d.rect(x + 2, y + 9, 58, 2, C.slate);
  if (part === "leader") { leader(d, i, C.slate); marker(d, i, C.coral); }
};
// A second finding on the same line gets its own marker beside the first, so a duplicate shows.
const marker = (d: PixelDraft, i: number, c: number) => {
  const dup = CARDS.slice(0, i).filter((k) => k.line === CARDS[i].line).length;
  d.rect(DIFF.x + DIFF.w - 4 - 3 * dup, lineY(DIFF, CARDS[i].line), 2, 3, c);
};
const leader = (d: PixelDraft, i: number, c: number) => {
  const cy = cardY(i) + 5, ly = lineY(DIFF, CARDS[i].line) + 1;
  d.line(CARD_X - 1, cy, LEAD_X, cy, c); d.line(LEAD_X, cy, LEAD_X, ly, c); d.line(LEAD_X, ly, DIFF.x + DIFF.w, ly, c);
};
const wholeCard = (d: PixelDraft, i: number) => (["frame", "label", "conf", "bar", "leader"] as const).forEach((p) => card(d, i, p));
const eraseCard = (d: PixelDraft, i: number) => {
  d.rect(CARD_X, cardY(i), CARD_W, CARD_H, C.paper); leader(d, i, C.paper);
  d.rect(GATE_X, lineY(DIFF, CARDS[i].line) + 1, 2, 1, C.teal);
  marker(d, i, DIFF.added.includes(CARDS[i].line) ? C.mint : C.paper);
};

const readDiff = (d: PixelDraft) => { pageFrame(d, DIFF); text(d, "DIFF", DIFF.x + 3, DIFF.y + 2, C.paper); pageLines(d, DIFF); };

// ---------------------------------------------------------------- 1. title (frames 0-105)
const title = (): Chapter => {
  const A = new Author(), mx = 20, my = 30, wx = 84;
  const spans: [number, number][] = [[1, 4], [4, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19]];
  MARK_ORDER.forEach((part, i) => A.step(part, spans[i][0], spans[i][1], (d) => markPart(2, part).forEach(([x, y, w, h, c]) => d.rect(mx + x, my + y, w, h, c))));
  A.step("word", 19, 26, (d) => text(d, "LINTCAT", wx, 47, C.navy, 2));
  A.step("sub", 26, 30, (d) => text(d, "HOW A REVIEW WORKS", wx, 64, C.slate));
  const events: [number, Pose][] = [...blink(20), [23, P("open", 1)], ...blink(24, P("open", 1)), [27, P("open", 0)], ...blink(28), [30, P("open", 1)], [31, P("open", 1, 1)], ...blink(32, P("open", 1, 1)), [34, P("open", -1, 1)]];
  return A.chapter("title", T.title, T.opened, (cel) => (cel < 19 ? [] : [stamp(catRects(2, poseAt(events, cel)), mx, my)]));
};

// ---------------------------------------------------------------- 2. a pull request opens (105-210)
const opened = (): Chapter => {
  const A = new Author();
  const PR: Page = { x: 24, y: 24, w: 73, h: 69, lines: 18, added: [5, 9, 13] };
  const QX = 112, QY = 40, slotY = (k: number) => QY + 3 + k * 9;
  const TOKEN: Rects = [[0, 0, 21, 5, C.amber], [2, 1, 3, 3, C.navy]];
  A.step("caption", 0, 5, (d) => text(d, "A PULL REQUEST OPENS", BIG_X, SUB_Y1, C.navy));
  A.step("pr-frame", 0, 3, (d) => pageFrame(d, PR));
  A.step("pr-title", 3, 4, (d) => text(d, "PR #42", PR.x + 3, PR.y + 2, C.paper));
  A.step("pr-lines", 4, 12, (d) => pageLines(d, PR));
  A.step("queue", 6, 10, (d) => { text(d, "QUEUE", QX, 32, C.navy); panel(d, QX, QY, 29, 31, C.paper, C.navy); for (let k = 0; k < 3; k++) frame(d, QX + 2, slotY(k), 25, 7, C.stone); });
  const bolt: [number, number][] = [[97, 44], [103, 40], [106, 48], [111, 44]];
  bolt.slice(1).forEach(([x, y], k) => A.step(`bolt${k}`, 12 + k, 13 + k, (d) => { const [px, py] = bolt[k]; d.line(px, py, x, y, C.amber); d.line(px, py + 1, x, y + 1, C.amber); }));
  A.step("bolt-tip", 15, 16, (d) => d.rect(109, 42, 3, 3, C.amber));
  A.step("token-in", 16, 17, (d) => TOKEN.forEach(([x, y, w, h, c]) => d.rect(QX + 4 + x, slotY(0) + 1 + y, w, h, c)));
  A.step("worker", 17, 19, (d) => text(d, "WORKER", 152, 60, C.navy));
  A.step("token-out", 19, 20, (d) => d.rect(QX + 4, slotY(0) + 1, 21, 5, C.paper));
  A.step("strip", 25, 30, (d) => strip(d, 0));
  A.step("caption2", 30, 34, (d) => text(d, "ONE JOB PER HEAD", BIG_X, SUB_Y2, C.slate));
  const hops: [number, number][] = [[124, 50], [132, 56], [140, 61], [148, 64], [156, 66]];
  const events: [number, Pose][] = [[17, P("open", -1)], [24, P("open", 0)], ...blink(27), [31, P("open", 0, 1)], ...blink(32, P("open", 0, 1)), [34, P("open", 1, 1)]];
  return A.chapter("opened", T.opened, T.read, (cel) => {
    const out: Placement[] = [];
    if (cel >= 17) out.push(stamp(catRects(4, poseAt(events, cel)), 156, 36));
    if (cel >= 19) { const [x, y] = hops[Math.min(hops.length - 1, cel - 19)]; out.push(stamp(TOKEN, x, y)); }
    return out;
  });
};

// ---------------------------------------------------------------- 3. read (210-390)
const read = (): Chapter => {
  const A = new Author();
  A.step("strip", 0, 1, (d) => strip(d, 0));
  A.step("word", 0, 4, (d) => big(d, "READ"));
  A.step("diff-frame", 0, 3, (d) => pageFrame(d, DIFF));
  A.step("diff-title", 3, 4, (d) => text(d, "DIFF", DIFF.x + 3, DIFF.y + 2, C.paper));
  A.step("lit", 4, 5, (d) => light(d, 0));
  A.step("diff-lines", 4, 12, (d) => pageLines(d, DIFF));
  const cursor = (d: PixelDraft, k: number) => { for (let i = 2 * k - 2; i < 2 * k; i++) if (i >= 0) d.rect(DIFF.x + 7, lineY(DIFF, i) + 2, DIFF.w - 12, 1, C.paper); for (let i = 2 * k; i < Math.min(DIFF.lines, 2 * k + 2); i++) underline(d, DIFF, i); };
  for (let k = 0; k <= 10; k++) A.step(`sweep${k}`, 12 + k, 13 + k, (d) => cursor(d, k));
  SIDES.forEach(([x, y, label], k) => {
    A.step(`${label}-page`, 22 + 6 * k, 24 + 6 * k, (d) => sidePage(d, x, y, label));
    A.step(`${label}-bars`, 24 + 6 * k, 28 + 6 * k, (d) => sideBars(d, x, y, C.stone, k * 3));
  });
  SIDES.forEach(([x, y, label], k) => A.step(`${label}-read`, 46 + k, 47 + k, (d) => sideBars(d, x, y, C.navy, k * 3)));
  A.step("sub1", 50, 54, (d) => text(d, "8 READ-ONLY TOOLS", subX("READ"), SUB_Y1, C.slate));
  A.step("sub2", 54, 57, (d) => text(d, "UP TO 12 TURNS", subX("READ"), SUB_Y2, C.slate));
  const events: [number, Pose][] = [[0, P("open", 1)], ...blink(9, P("open", 1)), [22, P("open", 1)], ...blink(33, P("open", 1)), [46, P("open", 1, 1)], ...blink(57, P("open", 0)), [59, P("open", 0, 1)]];
  return A.chapter("read", T.read, T.propose, (cel) => [stamp(catRects(4, poseAt(events, cel)), CAT.x, CAT.y)]);
};

// ---------------------------------------------------------------- 4. propose (390-540)
const propose = (): Chapter => {
  const A = new Author();
  A.step("carry", 0, 1, (d) => { readDiff(d); strip(d, 1); });
  A.step("word", 0, 7, (d) => big(d, "PROPOSE"));
  const plan: [string, number, number, (d: PixelDraft) => void][] = [["lit", 7, 8, (d) => light(d, 1)]];
  const events: [number, Pose][] = [[0, P("open", 1)]];
  CARDS.forEach((_, i) => {
    const s = 4 + 7 * i;
    plan.push([`card${i}-frame`, s, s + 1, (d) => card(d, i, "frame")]);
    plan.push([`card${i}-label`, s + 1, s + 2, (d) => { card(d, i, "label"); card(d, i, "conf"); }]);
    plan.push([`card${i}-bar`, s + 2, s + 3, (d) => card(d, i, "bar")]);
    plan.push([`card${i}-leader`, s + 3, s + 4, (d) => leader(d, i, C.slate)]);
    plan.push([`card${i}-marker`, s + 4, s + 5, (d) => marker(d, i, C.coral)]);
    events.push([s + 5, P("open", 1, 1)], [s + 6, P("open", 1, 0)]);
  });
  plan.sort((a, b) => a[1] - b[1]).forEach(([id, from, to, paint]) => A.step(id, from, to, paint));
  A.step("sub", 46, 49, (d) => text(d, "6 CANDIDATES", subX("PROPOSE"), SUB_Y1, C.slate));
  events.push(...blink(47, P("open", 0)), [49, P("open", 0, 1)]);
  return A.chapter("propose", T.propose, T.check, (cel) => [stamp(catRects(4, poseAt(events, cel)), CAT.x, CAT.y)]);
};

// ---------------------------------------------------------------- 5. check (540-735)
const check = (): Chapter => {
  const A = new Author();
  A.step("carry", 0, 1, (d) => { readDiff(d); CARDS.forEach((_, i) => wholeCard(d, i)); strip(d, 2); });
  A.step("word", 0, 5, (d) => big(d, "CHECK"));
  A.step("gate", 1, 4, (d) => d.rect(GATE_X, 22, 2, 75, C.teal));
  A.step("lit", 5, 6, (d) => light(d, 2));
  A.step("rule1", 6, 9, (d) => text(d, "ON A CHANGED LINE", subX("CHECK"), SUB_Y1, C.slate));
  A.step("rule2", 9, 12, (d) => text(d, "0.70+ AND UNIQUE", subX("CHECK"), SUB_Y2, C.slate));
  const order = [0, 1, 2, 3, 4, 5];
  order.forEach((i, k) => {
    const s = 12 + 5 * k, x = CARD_X, y = cardY(i), { line } = CARDS[i], fail = FAIL.find(([j]) => j === i);
    if (!fail) {
      A.step(`v${i}-border`, s, s + 1, (d) => frame(d, x, y, CARD_W, CARD_H, C.turquoise));
      A.step(`v${i}-check`, s + 1, s + 2, (d) => CHECK.forEach(([cx, cy, w, h, c]) => d.rect(x + 78 + cx, y + 3 + cy, w, h, c)));
      A.step(`v${i}-line`, s + 2, s + 3, (d) => { d.rect(DIFF.x + 1, lineY(DIFF, line), DIFF.w - 2, 3, C.turquoise); d.rect(DIFF.x + 7, lineY(DIFF, line) + 1, Math.min(DIFF.w - 12, WIDTHS[line]), 1, C.navy); });
      A.step(`v${i}-bar`, s + 3, s + 4, (d) => d.rect(x + 2, y + 9, 58, 2, C.turquoise));
      A.step(`v${i}-leader`, s + 4, s + 5, (d) => leader(d, i, C.turquoise));
    } else {
      A.step(`v${i}-border`, s, s + 1, (d) => frame(d, x, y, CARD_W, CARD_H, C.rust));
      A.step(`v${i}-cross`, s + 1, s + 2, (d) => CROSS.forEach(([cx, cy, w, h, c]) => d.rect(x + 78 + cx, y + 3 + cy, w, h, c)));
      A.step(`v${i}-erase`, s + 2, s + 3, (d) => d.rect(x + 2, y + 2, 74, 7, C.sand));
      A.step(`v${i}-reason`, s + 3, s + 5, (d) => text(d, fail[1], x + 2, y + 2, C.rust));
    }
  });
  PASS.forEach((i, k) => {
    A.step(`pulse${i}-a`, 42 + 2 * k, 43 + 2 * k, (d) => frame(d, CARD_X, cardY(i), CARD_W, CARD_H, C.navy));
    A.step(`pulse${i}-b`, 43 + 2 * k, 44 + 2 * k, (d) => frame(d, CARD_X, cardY(i), CARD_W, CARD_H, C.turquoise));
  });
  A.step("rule2-off", 48, 49, (d) => d.rect(subX("CHECK"), SUB_Y2, 100, 7, C.paper));
  A.step("sub", 49, 52, (d) => text(d, "3 OF 6 SURVIVE", subX("CHECK"), SUB_Y2, C.slate));
  FAIL.forEach(([i], k) => A.step(`drop${i}`, 52 + 3 * k, 55 + 3 * k, (d) => eraseCard(d, i)));
  const events: [number, Pose][] = [[0, P("open", 1)], ...blink(7, P("open", 1)), [16, P("open", 1, 1)], ...blink(26, P("open", 1)), [36, P("open", 1, 1)], ...blink(46, P("open", 1)), [56, P("open", 0)], ...blink(61, P("open", 0)), [63, P("open", -1)], [64, P("open", -1, 1)]];
  return A.chapter("check", T.check, T.post, (cel) => [stamp(catRects(4, poseAt(events, cel)), CAT.x, CAT.y)]);
};

// ---------------------------------------------------------------- 6. post (735-900)
const post = (): Chapter => {
  const A = new Author();
  const PR: Page = { x: 44, y: 22, w: 87, h: 75, lines: 20, added: [2, 7, 12], skip: [3, 4, 5, 8, 9, 10, 13, 14, 15] };
  const slots = [3, 8, 13].map((i) => lineY(PR, i));
  const BX = 50, BW = 75, BH = 9;
  const HOP: Rects = [[0, 0, 20, 9, C.sand], [0, 0, 20, 1, C.navy], [0, 8, 20, 1, C.navy], [0, 0, 1, 9, C.navy], [19, 0, 1, 9, C.navy]];
  A.step("carry", 0, 1, (d) => strip(d, 3));
  A.step("word", 0, 4, (d) => big(d, "POST"));
  A.step("pr-frame", 1, 4, (d) => pageFrame(d, PR));
  A.step("pr-title", 4, 5, (d) => text(d, "PR #42", PR.x + 3, PR.y + 2, C.paper));
  A.step("lit", 4, 5, (d) => light(d, 3));
  A.step("pr-lines", 5, 11, (d) => pageLines(d, PR));
  slots.forEach((y, k) => {
    const s = 17 + 9 * k;
    A.step(`c${k}-box`, s, s + 1, (d) => panel(d, BX, y, BW, BH, C.paper, C.slate));
    A.step(`c${k}-avatar`, s + 1, s + 2, (d) => MINI_CAT.forEach(([cx, cy, w, h, c]) => d.rect(BX + 2 + cx, y + 2 + cy, w, h, c)));
    A.step(`c${k}-text`, s + 2, s + 3, (d) => { d.rect(BX + 10, y + 3, 40, 1, C.slate); d.rect(BX + 10, y + 6, 30, 1, C.slate); });
    if (k < 2) A.step(`c${k}-fix`, s + 3, s + 4, (d) => { d.rect(BX + 55, y + 1, 19, 7, C.turquoise); text(d, "FIX", BX + 56, y + 1, C.paper); });
    else A.step(`c${k}-note`, s + 3, s + 4, (d) => text(d, "NOTE", BX + 52, y + 1, C.slate));
  });
  const KX = 138, KY = 24;
  A.step("badge-frame", 39, 40, (d) => panel(d, KX, KY, 51, 27, C.paper, C.navy));
  A.step("badge-1", 40, 41, (d) => text(d, "AI PR", KX + 3, KY + 3, C.navy));
  A.step("badge-2", 41, 43, (d) => text(d, "REVIEW", KX + 3, KY + 11, C.navy));
  A.step("badge-3", 43, 45, (d) => { d.rect(KX + 3, KY + 21, 3, 3, C.stone); text(d, "NEUTRAL", KX + 8, KY + 19, C.slate); });
  const DX = 138, DY = 58;
  A.step("dash-frame", 45, 46, (d) => panel(d, DX, DY, 51, 35, C.paper, C.navy));
  A.step("dash-label", 46, 48, (d) => text(d, "REVIEWS", DX + 3, DY + 3, C.navy));
  const bar = (k: number, h: number) => A.step(`dash-bar${k}`, 48 + k, 49 + k, (d) => d.rect(DX + 6 + 14 * k, DY + 32 - h, 8, h, C.turquoise));
  bar(0, 8);
  A.step("sub", 49, 55, (d) => text(d, "NEVER BLOCKS A MERGE", subX("POST"), SUB_Y2, C.slate));
  bar(1, 14); bar(2, 20);
  const events: [number, Pose][] = [[0, P("open", 1)], ...blink(10, P("open", 1)), [26, P("open", 1, 1)], ...blink(36, P("open", 1)), [45, P("open", 1, 1)], ...blink(51, P("open", 0)), [53, P("open", 0, 1)]];
  return A.chapter("post", T.post, T.payoff, (cel) => {
    const out = [stamp(catRects(4, poseAt(events, cel)), CAT.x, CAT.y)];
    slots.forEach((y, k) => { const h = cel - (12 + 9 * k); if (h >= 0 && h < 5) out.push(stamp(HOP, 150 - 25 * h, y)); });
    return out;
  });
};

// ---------------------------------------------------------------- 7. payoff (900-1050), held from 975
const payoff = (): Chapter => {
  const A = new Author(), mx = 12, my = 28, tx = 72;
  A.step("carry", 0, 1, (d) => strip(d, 4));
  A.step("line1", 0, 4, (d) => text(d, "NOTHING UNCHECKED", tx, 36, C.navy));
  A.step("line2", 4, 7, (d) => text(d, "REACHES YOUR", tx, 46, C.navy));
  A.step("line3", 7, 10, (d) => text(d, "PULL REQUEST", tx, 56, C.navy));
  A.step("rule", 14, 15, (d) => d.rect(tx, 65, textWidth("PULL REQUEST"), 2, C.turquoise));
  const events: [number, Pose][] = [
    [10, P("open", -1)], ...blink(11, P("open", -1)), [13, P("open", 0)], [15, P("open", 0, 1)], [16, P("open", 1, 1)], ...blink(17, P("open", 1, 1)), [19, P("open", 0, 1)], [20, P("open", 0)],
    ...blink(21, P("open", 0)), [23, P("open", -1)], ...blink(24, P("open", -1)), [26, P("open", -1, 1)],
    [27, P("open", 0, 1)], ...blink(30, P("open", 0, 1)), [33, P("open", 1, 1)], [35, P("open", 1)], [38, P("open", 0)], ...blink(41, P("open", 0)), [44, P("open", 0, 1)], [47, P("open", -1, 1)], [49, P("open", 0, 1)],
  ];
  return A.chapter("payoff", T.payoff, N, (cel) => [stamp(catRects(2, poseAt(events, cel)), mx, my)]);
};

const CHAPTERS = [title(), opened(), read(), propose(), check(), post(), payoff()];
const problems = checkTimeline(CHAPTERS, N, HOLDS);
if (problems.length) throw new Error(`lintcatReview timeline:\n  ${problems.join("\n  ")}`);

export const lintcatReview: Film = {
  meta: { title: "LintCat: how a review works", W: 1920, H: 1080, fps: FPS, bpm: BPM, durationFrames: N, kind: "explainer", raster: "cpu", step: CEL, holds: HOLDS },
  assets: { images: {} },
  shots: CHAPTERS.map((ch) => ({
    id: ch.id, start: ch.start, end: ch.end,
    draw: (ctx, local, env) => {
      const buf = new Uint8Array(G * H).fill(C.paper);
      compose(ch, Math.floor(local / CEL), buf);
      blit(ctx, buf, G, H, PALETTE, Math.round(env.W * env.scale), Math.round(env.H * env.scale), PALETTE[C.paper]);
    },
  })),
};
