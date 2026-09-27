// STAGE 4 - load and scope. packages/reviewer/src/review-run.ts fetches the PR, files and diff
// in parallel; review-scope.ts reviews only what changed since the last commit with our check run.
import { arrow, box, C, card, cat, disc, dotted, drawingFilm, footer, heading, ring, stroke, text, textCentred } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

const COMMITS = [90, 110, 130, 150, 170], Y = 40;

const author = (d: PixelDraft) => {
  d.setPass(0);
  heading(d, "ONLY WHAT CHANGED SINCE");
  box(d, 8, 22, 26, 40, C.ink, C.shade); textCentred(d, 21, 25, "GITHUB", C.ink);
  cat(d, 8, 76, 24, "ahead");
  // 1: three fetches, in parallel
  d.setPass(1);
  card(d, 46, 24, 18, "PR"); card(d, 46, 36, 28, "FILES"); card(d, 46, 48, 24, "DIFF");
  for (const y of [28, 40, 52]) arrow(d, [34, y], [44, y], C.half);
  text(d, 46, 60, "IN PARALLEL", C.half);
  // 2: the PR's commits
  d.setPass(2);
  stroke(d, [[84, Y], [184, Y]], C.ink);
  COMMITS.forEach((x, i) => { disc(d, x, Y, 3, C.paper); ring(d, x, Y, 3, C.ink); text(d, x - 3, Y + 6, `C${i + 1}`, C.half); });
  // 3: the baseline: the last commit that carries our check run
  d.setPass(3);
  card(d, 120, 20, 26, "CHECK", C.tealDeep, C.tealTint); arrow(d, [130, 29], [130, 36], C.teal);
  text(d, 116, 52, "BASELINE", C.teal);
  // 4: only files changed since then are reviewed
  d.setPass(4);
  for (const x of COMMITS.slice(3)) disc(d, x, Y, 3, C.coral);
  stroke(d, [[144, 58], [144, 60], [184, 60], [184, 58]], C.coral); text(d, 154, 62, "SINCE", C.coral);
  text(d, 146, 70, "A.TS B.TS", C.coral); text(d, 146, 76, "REVIEWED", C.coral);
  text(d, 86, 70, "C.TS D.TS E.TS", C.rule); text(d, 86, 76, "ALREADY SEEN", C.half);
  // 5: any doubt and the scope widens to the whole PR
  d.setPass(5);
  dotted(d, [170, 33], [136, 33], C.amber); dotted(d, [124, 33], [92, 33], C.amber); arrow(d, [96, 33], [92, 33], C.amber);
  text(d, 86, 14, "DOUBT? WIDEN TO WHOLE PR", C.amber);
  // 6: findings nobody resolved are carried forward
  d.setPass(6);
  card(d, 84, 84, 54, "OPEN FINDING", C.ink, C.coralTint); arrow(d, [138, 88], [142, 88], C.half); card(d, 144, 84, 36, "CARRIED");
  text(d, 84, 96, "UNRESOLVED STAYS LISTED", C.half);
  // 7
  d.setPass(7);
  cat(d, 8, 76, 24, "right");
  footer(d, "PACKAGES/REVIEWER/SRC/REVIEW-SCOPE.TS");
};

export const stage04Scope = drawingFilm({
  id: "stage04Scope", title: "04 - Only what changed since", author,
  budgets: [8, 8, 8, 6, 9, 6, 7, 4], rest: 3, seconds: 9, hold: 45,
});
