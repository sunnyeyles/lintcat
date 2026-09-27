// STAGE 1 - the webhook. apps/web/app/api/github/webhook/handler.ts checks the HMAC signature,
// parses the payload with Zod, then asks the repo's review mode whether this PR wants a review.
import { arrow, box, C, card, cat, drawingFilm, fill, footer, heading, stroke, text, textCentred, tick } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

const author = (d: PixelDraft) => {
  d.setPass(0);
  heading(d, "GITHUB KNOCKS");
  box(d, 8, 26, 44, 34, C.ink, C.shade); textCentred(d, 30, 29, "GITHUB", C.ink);
  card(d, 13, 38, 34, "PR #412"); text(d, 16, 50, "OPENED", C.half);
  box(d, 140, 26, 46, 56, C.ink, C.paper); textCentred(d, 163, 29, "LINTCAT", C.ink); textCentred(d, 163, 35, "/API/GITHUB", C.half); textCentred(d, 163, 41, "/WEBHOOK", C.half);
  cat(d, 151, 54, 24, "ahead");
  // 1: the pull_request event sets off along the path
  d.setPass(1);
  arrow(d, [52, 43], [138, 43], C.half);
  box(d, 58, 37, 16, 12, C.ink, C.paper); stroke(d, [[59, 38], [66, 44], [72, 38]], C.ink);
  text(d, 56, 18, "PULL_REQUEST EVENT", C.half);
  // 2: the wax seal, HMAC over the raw body
  d.setPass(2);
  fill(d, 82, 38, 11, 11, C.coral); box(d, 82, 38, 11, 11, C.coralDeep); tick(d, 84, 41, C.white);
  text(d, 80, 52, "HMAC", C.ink); text(d, 80, 58, "SEAL", C.half);
  // 3: the stencil, Zod over the payload
  d.setPass(3);
  box(d, 102, 37, 14, 13, C.ink, C.shade); fill(d, 105, 40, 3, 2, C.paper); fill(d, 110, 40, 3, 2, C.paper); fill(d, 105, 45, 8, 2, C.paper);
  text(d, 100, 52, "ZOD", C.ink); text(d, 100, 58, "SHAPE", C.half);
  // 4: the switch, the repo's review mode
  d.setPass(4);
  box(d, 122, 37, 14, 13, C.ink, C.paper); stroke(d, [[124, 40], [124, 47]], C.rule); stroke(d, [[128, 40], [128, 47]], C.teal); stroke(d, [[132, 40], [132, 47]], C.rule);
  fill(d, 127, 42, 3, 3, C.teal);
  text(d, 120, 52, "MODE", C.ink); text(d, 120, 58, "LABEL", C.teal);
  fill(d, 13, 50, 38, 7, C.teal); text(d, 14, 51, "AI-REVIEW", C.white);
  // 5: it reaches the door; the cat looks up
  d.setPass(5);
  cat(d, 151, 54, 24, "left");
  textCentred(d, 96, 87, "EVERY_PR, LABEL, OR OFF: THE REPO DECIDES", C.half);
  textCentred(d, 96, 94, "SIGNATURE, THEN SHAPE, THEN THE MODE", C.ink);
  footer(d, "APPS/WEB/APP/API/GITHUB/WEBHOOK/HANDLER.TS");
};

export const stage01Webhook = drawingFilm({
  id: "stage01Webhook", title: "01 - GitHub knocks", author,
  budgets: [10, 8, 6, 6, 8, 8], rest: 3, seconds: 8, hold: 45,
});
