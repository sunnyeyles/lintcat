// LINTCAT · how a review happens. A pull request rides a belt past the cat: read, propose,
// a gate with no model behind it, post. 160 x 90 cells, 16 brand colours, cels held 3 frames.
import type { Film } from "anidoodle/canvas-core/film";
import { blit, PixelDraft } from "anidoodle/canvas-core/pixelArtKit";

export const PALETTE = [
  "#0b1311", // 0 ground (dark canvas)
  "#1e2d42", // 1 navy: the cat
  "#4a5b72", // 2 slate: gate, context rows, quiet captions
  "#1d5c5a", // 3 teal: belt
  "#3aa693", // 4 turquoise: added rows, badge, nose, whiskers
  "#317a71", // 5 accent: gate flash on a pass
  "#f47b4e", // 6 coral: pupils, findings
  "#c4552c", // 7 rust: removed rows, gate flash on a drop
  "#f5efe3", // 8 paper: eyes, card, lit text
  "#e4dccc", // 9 sand: low-confidence findings
  "#faf6ee", // 10 highlight
  "#142221", // 11 belt slats and shadow
  "#2b4160", // 12 navy lit: rim on the cat
  "#8f8878", // 13 badge, unlit
  "#7a4a3a", // 14 coral dim
  "#101a2a", // 15 card ink
];

const G = 160, GH = 90, CEL = 3, CELS = 100, N = CELS * CEL;
const BELT_Y = 74, CARD_W = 36, CARD_H = 30, CARD_Y = 44, LANE_Y = 14, GATE_X = 97;
const CAT_X = 42, CAT_Y = 22;
const BADGE = { x: 108, y: 22, w: 50, h: 11 };

// 3 x 5 capitals, only the letters the captions use.
const FONT: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"], C: ["111", "100", "100", "100", "111"], D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"], H: ["101", "101", "111", "101", "101"], I: ["111", "010", "010", "010", "111"],
  K: ["101", "101", "110", "101", "101"], L: ["100", "100", "100", "100", "111"], M: ["101", "111", "111", "101", "101"],
  N: ["110", "101", "101", "101", "101"], O: ["111", "101", "101", "101", "111"], P: ["111", "101", "111", "100", "100"],
  R: ["111", "101", "110", "101", "101"], S: ["111", "100", "111", "001", "111"], T: ["111", "010", "010", "010", "010"],
  V: ["101", "101", "101", "101", "010"], W: ["101", "101", "101", "111", "101"], " ": ["000", "000", "000", "000", "000"],
};
const text = (d: PixelDraft, s: string, x: number, y: number, c: number) => {
  let cx = x;
  for (const ch of s) { (FONT[ch] ?? FONT[" "]).forEach((row, j) => [...row].forEach((b, i) => { if (b === "1") d.px(cx + i, y + j, c); })); cx += 4; }
};
const textW = (s: string) => s.length * 4 - 1;

// Diff rows on the card: [colour, length]. Findings may only land on added (turquoise) rows.
const ROWS: [number, number][] = [[4, 22], [2, 16], [4, 26], [7, 18], [2, 12], [4, 30], [7, 20]];
const rowY = (r: number) => CARD_Y + 8 + 3 * r;
// One candidate finding per slot; `cross` is the cel its centre reaches the gate, `drop` the cel a survivor falls.
const FINDINGS = [
  { slot: 3, low: false, row: 0, spawn: 30, drop: 74 },
  { slot: 10, low: true, row: 1, spawn: 34, drop: 0 },
  { slot: 17, low: false, row: 2, spawn: 38, drop: 72 },
  { slot: 24, low: true, row: 3, spawn: 42, drop: 0 },
  { slot: 31, low: false, row: 5, spawn: 46, drop: 70 },
].map((f) => ({ ...f, cross: Math.ceil((GATE_X - 3 + 40 - f.slot) / 2) }));
const cardX = (cel: number) => 2 * cel - 40;
const CAPTIONS = ["READ", "PROPOSE", "CHECK", "POST"];
const BUBBLE = [".####.", "######", "######", ".####.", "..#..."];
const FALL = [{ dy: 3, level: 3 }, { dy: 8, level: 2 }, { dy: 14, level: 1 }];

type Mark = { kind: "bubble"; x: number; y: number; low: boolean; level: number } | { kind: "marker"; x: number; y: number };
const findingAt = (f: (typeof FINDINGS)[number], cel: number): Mark | null => {
  if (cel < f.spawn) return null;
  const k = cel - f.spawn, cx = cardX(cel);
  if (f.low && cel >= f.cross) {
    const fall = FALL[cel - f.cross]; if (!fall) return null;
    return { kind: "bubble", x: GATE_X - 3, y: LANE_Y + fall.dy, low: true, level: fall.level };
  }
  if (!f.low && cel >= f.drop) {
    const y = Math.min(rowY(f.row), LANE_Y + 6 * (cel - f.drop));
    return y >= rowY(f.row) ? { kind: "marker", x: cx + f.slot + 1, y } : { kind: "bubble", x: cx + f.slot, y, low: false, level: 4 };
  }
  // Rises from the cat's crown and drifts over to ride above its row of the card.
  const t = Math.min(1, k / 8);
  return { kind: "bubble", x: Math.round(CAT_X + 7 + (cx + f.slot - CAT_X - 7) * t), y: Math.max(LANE_Y, CAT_Y - 5 - k), low: f.low, level: 4 };
};

const drawCat = (d: PixelDraft, cel: number, cx: number) => {
  const R = (x: number, y: number, w: number, h: number, c: number) => d.rect(CAT_X + x, CAT_Y + y, w, h, c);
  const centre = cx + CARD_W / 2, visible = cx > -CARD_W && cx < G;
  const gaze = !visible ? 0 : centre < CAT_X + 4 ? -1 : centre > CAT_X + 16 ? 1 : 0;
  const blink = cel === 12 || cel === 62, whiskUp = Math.floor(cel / 5) % 2 === 0;
  R(3, 2, 4, 4, 1); R(13, 2, 4, 4, 1); R(2, 6, 16, 12, 1);
  R(3, 2, 4, 1, 12); R(13, 2, 4, 1, 12); R(2, 6, 16, 1, 12); R(2, 6, 1, 12, 12);
  R(4, 4, 2, 2, 4); R(14, 4, 2, 2, 4);
  if (blink) { R(4, 10, 4, 1, 8); R(12, 10, 4, 1, 8); }
  else { R(4, 9, 4, 3, 8); R(12, 9, 4, 3, 8); R(5 + gaze, 10, 2, 2, 6); R(13 + gaze, 10, 2, 2, 6); }
  R(9, 14, 2, 2, 4);
  R(0, whiskUp ? 11 : 12, 3, 1, 4); R(17, whiskUp ? 12 : 11, 3, 1, 4);
};

const author = (cel: number): Uint8Array => {
  const d = new PixelDraft(G, GH, 0), cx = cardX(cel);
  const beat = Math.min(3, Math.floor(cel / 25));
  // belt and its slats, moving with the card
  d.rect(0, BELT_Y, G, 5, 3);
  for (let x = ((-2 * cel) % 8 + 8) % 8; x < G; x += 8) d.rect(x, BELT_Y, 1, 5, 11);
  d.rect(0, BELT_Y + 5, G, 1, 11);
  // the cat: a seated body behind the belt, shoulders stepping out, a collar; head above the card
  for (let y = CAT_Y + 20; y < BELT_Y; y++) { const w = Math.min(18, 12 + 2 * Math.floor((y - CAT_Y - 20) / 2)); d.rect(CAT_X + 10 - w / 2, y, w, 1, 1); }
  d.rect(CAT_X + 3, CAT_Y + 26, 14, 2, 4);
  drawCat(d, cel, cx);
  text(d, "LINT", 8, 3, 8); text(d, "CAT", 8 + textW("LINT") + 1, 3, 4);
  // the pull request card
  if (cx > -CARD_W && cx < G) {
    d.rect(cx, CARD_Y, CARD_W, CARD_H, 15); d.rect(cx + 1, CARD_Y + 1, CARD_W - 2, CARD_H - 2, 8);
    d.rect(cx + 1, CARD_Y + 1, CARD_W - 2, 6, 1); text(d, "PR", cx + 3, CARD_Y + 2, 8);
    ROWS.forEach(([c, len], r) => d.rect(cx + 4, rowY(r), len, 2, c));
  }
  // findings: bubbles, the ones the gate drops, and the markers that land
  const marks = FINDINGS.map((f) => findingAt(f, cel));
  marks.forEach((m) => {
    if (!m) return;
    if (m.kind === "marker") { d.rect(m.x, m.y, 4, 2, 6); return; }
    BUBBLE.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "#" && PixelDraft.dith(m.x + i, m.y + j, m.level)) d.px(m.x + i, m.y + j, m.low ? 9 : 6); }));
    if (!m.low) d.rect(m.x + 2, m.y + 1, 2, 1, 8);
  });
  // the gate: no model behind it. Flashes accent for a pass, rust for a drop.
  const pass = FINDINGS.some((f) => !f.low && f.cross === cel), drop = FINDINGS.some((f) => f.low && f.cross === cel);
  const post = pass ? 5 : drop ? 7 : 2;
  d.rect(GATE_X - 7, 10, 15, 3, 2); d.rect(GATE_X - 7, 10, 3, BELT_Y - 10, post); d.rect(GATE_X + 5, 10, 3, BELT_Y - 10, post);
  text(d, "NO MODEL", GATE_X - Math.floor(textW("NO MODEL") / 2), 3, 2);
  // the check run badge lights once the survivors have landed
  const lit = cel >= 83;
  d.rect(BADGE.x, BADGE.y, BADGE.w, BADGE.h, lit ? 3 : 13); d.rect(BADGE.x + 1, BADGE.y + 1, BADGE.w - 2, BADGE.h - 2, lit ? 4 : 0);
  text(d, "AI PR REVIEW", BADGE.x + 2, BADGE.y + 3, lit ? 8 : 13);
  // the four beats, the current one lit
  let tx = 30;
  CAPTIONS.forEach((w, i) => { text(d, w, tx, 82, i === beat ? 8 : 2); tx += textW(w) + 8; });
  return d.buf;
};

export const lintcatLoop: Film = {
  meta: { title: "LintCat · how a review happens", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: N, kind: "loop", step: CEL },
  assets: { images: {} },
  shots: [{
    id: "loop", start: 0, end: N,
    draw: (ctx, f, env) => blit(ctx, author(Math.floor(f / CEL)), G, GH, PALETTE, Math.round(env.W * env.scale), Math.round(env.H * env.scale), PALETTE[0]),
  }],
};
