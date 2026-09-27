// STAGE 8 - publish, record, settle. publish-review.ts writes fix commit, comments, then the
// neutral check run; record-review.ts ingests the dashboard record; run-job.ts settles the job.
import { arrow, box, C, card, cat, drawingFilm, footer, heading, text } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

const author = (d: PixelDraft) => {
  d.setPass(0);
  heading(d, "POST, RECORD, SETTLE");
  box(d, 8, 22, 54, 40, C.ink, C.paper); text(d, 11, 24, "RENDER, PURE", C.ink);
  box(d, 84, 22, 58, 54, C.ink, C.shade); text(d, 87, 24, "PR ON GITHUB", C.ink);
  box(d, 148, 22, 40, 54, C.ink, C.paper); text(d, 151, 24, "DASHBOARD", C.ink);
  cat(d, 8, 72, 24, "ahead");
  // 1: three rendered things, no I/O yet
  d.setPass(1);
  card(d, 12, 32, 46, "REVIEW BODY"); card(d, 12, 42, 46, "COMMENTS"); card(d, 12, 52, 46, "CHECK RUN");
  // 2, 3, 4: the writes, in order, each asking "cancelled?" first
  d.setPass(2);
  arrow(d, [62, 36], [82, 36], C.teal); card(d, 88, 32, 52, "1 FIX COMMIT", C.ink, C.tealTint);
  d.setPass(3);
  arrow(d, [62, 46], [82, 46], C.teal); card(d, 88, 42, 52, "2 COMMENTS", C.ink, C.tealTint);
  d.setPass(4);
  arrow(d, [62, 56], [82, 56], C.teal); card(d, 88, 52, 52, "3 CHECK RUN", C.ink, C.tealTint);
  text(d, 88, 63, "NEUTRAL CHECK", C.half); text(d, 88, 69, "CANCELLED?", C.half); text(d, 130, 69, "NO", C.teal);
  // 5: the record: rows, never the patch text; the graph gzipped
  d.setPass(5);
  arrow(d, [142, 44], [146, 44], C.half);
  card(d, 150, 32, 36, "REVIEW"); card(d, 150, 41, 36, "FINDING"); card(d, 150, 50, 36, "RISK"); card(d, 150, 59, 36, "GRAPH");
  // 6: the job settles
  d.setPass(6);
  text(d, 40, 74, "JOB SETTLES", C.half);
  card(d, 40, 80, 38, "COMPLETE", C.white, C.teal); card(d, 82, 80, 46, "SUPERSEDED");
  card(d, 40, 91, 38, "RETRY X3", C.amber, C.paper); card(d, 82, 91, 46, "FAILED", C.coralDeep, C.coralTint);
  text(d, 134, 82, "A FINAL FAIL", C.half); text(d, 134, 88, "POSTS A", C.half); text(d, 134, 94, "FAILURE CHECK", C.half);
  // 7
  d.setPass(7);
  cat(d, 8, 72, 24, "right");
  footer(d, "PACKAGES/REVIEWER/SRC/PUBLISH-REVIEW.TS");
};

export const stage08Publish = drawingFilm({
  id: "stage08Publish", title: "08 - Post, record, settle", author,
  budgets: [10, 6, 6, 5, 6, 8, 9, 3], rest: 3, seconds: 9, hold: 45,
});
