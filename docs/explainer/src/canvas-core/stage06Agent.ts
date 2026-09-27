// STAGE 6 - the agent. packages/ai/src/agents/runtime.ts runs one general agent over eight
// read-only tools for at most 12 turns; output.ts parses the final JSON with Zod.
import { arrow, box, C, card, cat, drawingFilm, footer, heading, ring, text } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

const TOOLS = ["GET_PULL_REQUEST", "CHANGED_FILES", "GET_DIFF", "GET_FILE", "GET_BASE_FILE", "SEARCH_REPO", "FIND_REFERENCES", "FIND_CO_CHANGED"];

const author = (d: PixelDraft) => {
  d.setPass(0);
  heading(d, "READ, THEN PROPOSE");
  cat(d, 78, 40, 28, "ahead");
  // 1: the opening message, assembled before the first turn
  d.setPass(1);
  box(d, 6, 20, 60, 64, C.ink, C.paper); text(d, 9, 22, "OPENING MSG", C.ink);
  card(d, 10, 30, 54, "<REPOSITORY>"); card(d, 10, 42, 54, "<INDEX>"); card(d, 10, 54, 54, "<IMPORTS>"); card(d, 10, 66, 54, "<DIFF>");
  text(d, 10, 77, "READ ONLY", C.half);
  arrow(d, [66, 54], [72, 54], C.half);
  // 2: eight tools, each one a read
  d.setPass(2);
  TOOLS.forEach((t, i) => card(d, 120, 20 + i * 10, 70, t, C.ink, C.shade));
  // 3: the loop: call, result, at most twelve turns
  d.setPass(3);
  ring(d, 92, 54, 18, C.teal);
  arrow(d, [110, 46], [118, 46], C.teal); arrow(d, [118, 62], [110, 62], C.teal);
  text(d, 76, 76, "12 TURNS", C.teal);
  // 4: what comes out is JSON, parsed before anyone trusts it
  d.setPass(4);
  arrow(d, [94, 82], [94, 90], C.ink); card(d, 70, 92, 49, "PARSED JSON", C.ink, C.coralTint);
  // 5: meanwhile, reviewer suggestions from blame and CODEOWNERS
  d.setPass(5);
  text(d, 6, 86, "MEANWHILE,", C.half); text(d, 6, 92, "REVIEWERS FROM", C.half); text(d, 6, 98, "BLAME+OWNERS", C.half);
  // 6
  d.setPass(6);
  cat(d, 78, 40, 28, "right");
  footer(d, "PACKAGES/AI/SRC/AGENTS/RUNTIME.TS");
};

export const stage06Agent = drawingFilm({
  id: "stage06Agent", title: "06 - Read, then propose", author,
  budgets: [8, 10, 12, 8, 6, 5, 4], rest: 3, seconds: 9, hold: 45,
});
