// STAGE 2 - the queue. packages/db/src/review-jobs.ts keeps one job per head SHA; the web app
// pings the Cloud Run worker (apps/worker/src/worker.ts), which claims one job at a time.
import { arrow, box, C, card, cat, dither, dotted, drawingFilm, footer, heading, text, textCentred } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

const author = (d: PixelDraft) => {
  d.setPass(0);
  heading(d, "ONE JOB PER HEAD");
  box(d, 8, 22, 72, 62, C.ink, C.paper); text(d, 11, 24, "REVIEW_JOBS", C.ink);
  box(d, 116, 22, 70, 46, C.ink, C.shade); textCentred(d, 151, 25, "CLOUD RUN WORKER", C.ink);
  cat(d, 158, 40, 24, "ahead");
  // 1: a job for the head that just arrived
  d.setPass(1);
  card(d, 14, 34, 46, "PR412 A1F2");
  // 2: a newer head for the same PR supersedes it
  d.setPass(2);
  card(d, 14, 46, 46, "PR412 B7C9", C.ink, C.tealTint);
  dither(d, 15, 35, 44, 7, C.coralTint, 2); text(d, 64, 36, "OLD", C.coral);
  text(d, 8, 88, "NEWER HEAD SUPERSEDES", C.half);
  // 3: a repeat delivery is a no-op
  d.setPass(3);
  dotted(d, [14, 58], [59, 58], C.half); dotted(d, [14, 66], [59, 66], C.half); dotted(d, [14, 58], [14, 66], C.half); dotted(d, [59, 58], [59, 66], C.half);
  text(d, 17, 60, "PR412 B7C9", C.half); text(d, 64, 60, "DUP", C.coral);
  text(d, 8, 94, "REPEAT DELIVERY: NO-OP", C.half);
  // 4: the web app pokes the worker
  d.setPass(4);
  box(d, 96, 84, 22, 10, C.ink, C.paper); text(d, 101, 86, "WEB", C.ink);
  arrow(d, [107, 84], [124, 69], C.teal); text(d, 93, 74, "PING", C.teal);
  // 5: Cloud Scheduler sweeps what a ping missed
  d.setPass(5);
  box(d, 128, 84, 44, 10, C.ink, C.paper); text(d, 131, 86, "SCHEDULER", C.ink);
  arrow(d, [150, 84], [150, 69], C.half); text(d, 153, 74, "SWEEP", C.half);
  // 6: the worker claims one job
  d.setPass(6);
  arrow(d, [80, 50], [114, 50], C.teal); text(d, 84, 43, "CLAIM", C.teal); text(d, 84, 54, "ONE", C.teal);
  card(d, 120, 46, 36, "412 B7C9", C.ink, C.tealTint);
  cat(d, 158, 40, 24, "left");
  footer(d, "PACKAGES/DB/SRC/REVIEW-JOBS.TS");
};

export const stage02Queue = drawingFilm({
  id: "stage02Queue", title: "02 - One job per head", author,
  budgets: [10, 5, 8, 7, 6, 6, 9], rest: 3, seconds: 8, hold: 45,
});
