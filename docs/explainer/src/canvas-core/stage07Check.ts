// STAGE 7 - the trust boundary. packages/reviewer/src/validate-findings.ts keeps only findings
// that pass every gate; validate-patches.ts keeps only patches whose expected text matches head.
import { box, C, card, cat, cross, drawingFilm, fill, footer, heading, stroke, text, textCentred, tick } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

const GATES = ["SCHEMA", "OWN CATEGORY", "FILE IN PR", "ADDED LINE", "CONF >= 0.70", "DEDUPE", "CAP 10"];
const DROPS = new Set([3, 4]);

const author = (d: PixelDraft) => {
  d.setPass(0);
  heading(d, "EVERY FINDING CHECKED");
  fill(d, 0, 16, 192, 11, C.lavender); textCentred(d, 96, 19, "UNTRUSTED: WHAT THE MODEL PROPOSED", C.ink);
  cat(d, 162, 40, 22, "ahead");
  // 1: the line nothing crosses unchecked
  d.setPass(1);
  fill(d, 0, 28, 192, 2, C.ink); text(d, 4, 32, "TRUST BOUNDARY", C.ink);
  // 2: the gates, one row each
  d.setPass(2);
  GATES.forEach((g, i) => { const y = 40 + i * 8; text(d, 8, y, g, C.ink); box(d, 64, y - 1, 7, 7, C.ink); });
  // 3: each finding passes or is dropped
  d.setPass(3);
  GATES.forEach((_, i) => { const y = 40 + i * 8; if (DROPS.has(i)) { cross(d, 65, y, C.coral); text(d, 74, y, "DROP", C.coral); } else tick(d, 65, y, C.teal); });
  // 4: patches are laid over the file at head
  d.setPass(4);
  box(d, 96, 36, 58, 58, C.ink, C.paper); text(d, 99, 38, "HEAD FILE", C.ink);
  for (let i = 0; i < 7; i++) stroke(d, [[100, 46 + i * 6], [130 + (i % 3) * 6, 46 + i * 6]], C.rule);
  // 5: expected text must match byte for byte
  d.setPass(5);
  card(d, 104, 50, 40, "EXPECTED", C.tealDeep, C.tealTint); tick(d, 146, 52, C.teal); text(d, 104, 60, "BYTES MATCH", C.teal);
  card(d, 104, 70, 40, "OVERLAP", C.coralDeep, C.coralTint); cross(d, 147, 72, C.coral); text(d, 104, 80, "REJECTED", C.coral);
  text(d, 96, 97, "MAX 5 FILES / 200 LINES", C.half);
  // 6
  d.setPass(6);
  cat(d, 162, 40, 22, "left");
  footer(d, "PACKAGES/REVIEWER/SRC/VALIDATE-FINDINGS.TS");
};

export const stage07Check = drawingFilm({
  id: "stage07Check", title: "07 - Every finding checked", author,
  budgets: [10, 4, 10, 8, 7, 9, 4], rest: 3, seconds: 9, hold: 45,
});
