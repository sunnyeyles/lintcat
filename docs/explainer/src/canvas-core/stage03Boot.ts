// STAGE 3 - the job boots. apps/worker/src/run-job.ts renews a lease, mints an installation
// token, checks the head has not moved, decrypts the org's model key and picks the model.
import { arrow, box, C, card, cat, disc, drawingFilm, fill, footer, heading, stroke, text, tick } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

const ROWS = [22, 37, 52, 67, 82];
const row = (d: PixelDraft, i: number, label: string) => { box(d, 10, ROWS[i], 7, 7, C.ink); text(d, 22, ROWS[i] + 1, label, C.ink); };
const done = (d: PixelDraft, i: number) => tick(d, 11, ROWS[i] + 1, C.teal);

const author = (d: PixelDraft) => {
  d.setPass(0);
  heading(d, "LEASE, TOKEN, KEY");
  cat(d, 164, 20, 24, "ahead");
  stroke(d, [[8, 18], [150, 18]], C.rule);
  // 1: the lease, renewed on a heartbeat
  d.setPass(1);
  row(d, 0, "LEASE HEARTBEAT");
  stroke(d, [[96, 26], [104, 26], [107, 20], [110, 30], [113, 26], [130, 26], [133, 20], [136, 30], [139, 26], [150, 26]], C.teal);
  done(d, 0);
  // 2: a GitHub App installation token
  d.setPass(2);
  row(d, 1, "INSTALLATION TOKEN");
  disc(d, 100, 41, 3, C.teal); stroke(d, [[103, 41], [118, 41], [118, 45]], C.teal); stroke(d, [[114, 41], [114, 44]], C.teal);
  text(d, 124, 39, "GH APP", C.half);
  done(d, 1);
  // 3: is the head still the one this job was queued for?
  d.setPass(3);
  row(d, 2, "HEAD STILL A1F2?");
  card(d, 96, 52, 26, "A1F2"); text(d, 126, 54, "=", C.ink); card(d, 134, 52, 26, "A1F2", C.ink, C.tealTint);
  text(d, 22, 60, "MOVED? SUPERSEDED", C.amber);
  done(d, 2);
  // 4: the org's model key comes out of the vault
  d.setPass(4);
  row(d, 3, "ORG MODEL KEY");
  box(d, 96, 65, 14, 11, C.ink, C.shade); fill(d, 102, 68, 2, 4, C.ink); arrow(d, [112, 70], [120, 70], C.teal);
  disc(d, 125, 70, 2, C.teal); stroke(d, [[127, 70], [136, 70], [136, 73]], C.teal);
  text(d, 22, 76, "NO KEY? A NEUTRAL 'ADD A KEY' CHECK", C.amber);
  done(d, 3);
  // 5: provider and model
  d.setPass(5);
  row(d, 4, "PROVIDER + MODEL");
  card(d, 96, 81, 40, "ANTHROPIC", C.white, C.teal); card(d, 140, 81, 30, "OPENAI");
  done(d, 4);
  // 6: the cat has read the list
  d.setPass(6);
  cat(d, 164, 20, 24, "left");
  text(d, 22, 95, "FIVE CHECKS BEFORE A SINGLE MODEL CALL", C.half);
  footer(d, "APPS/WORKER/SRC/RUN-JOB.TS");
};

export const stage03Boot = drawingFilm({
  id: "stage03Boot", title: "03 - Lease, token, key", author,
  budgets: [8, 7, 7, 8, 8, 6, 5], rest: 3, seconds: 8, hold: 45,
});
