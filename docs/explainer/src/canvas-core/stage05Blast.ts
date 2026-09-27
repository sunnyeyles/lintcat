// STAGE 5 - blast radius. packages/index/src/impact.ts walks importers 3 hops out from each
// changed file; packages/reviewer/src/risk-score.ts turns the counts into 0-100.
import { arrow, box, C, cat, dial, dither, drawingFilm, fill, ring, stroke, text, textCentred, textWidth } from "./lintcatKit";
import type { PixelDraft } from "./pixelArtKit";

type Node = { id: string; x: number; y: number; hop: number; role?: "entry" | "test" };
// Importers point at what they import; the blast walks the arrows backwards, importer by importer.
const NODES: Node[] = [
  { id: "REVIEW-RUN", x: 92, y: 56, hop: 0 },
  { id: "RUN-JOB", x: 74, y: 36, hop: 1 },
  { id: "CLI", x: 74, y: 74, hop: 1 },
  { id: "MCP", x: 100, y: 88, hop: 1 },
  { id: "WORKER", x: 36, y: 36, hop: 2, role: "entry" },
  { id: "HOOK", x: 36, y: 74, hop: 2 },
  { id: "ENGINE", x: 128, y: 88, hop: 2 },
  { id: "SERVER", x: 36, y: 20, hop: 3, role: "entry" },
  { id: "JOB.TEST", x: 74, y: 20, hop: -1, role: "test" },
];
const EDGES: [string, string][] = [
  ["RUN-JOB", "REVIEW-RUN"], ["CLI", "REVIEW-RUN"], ["MCP", "REVIEW-RUN"], ["WORKER", "RUN-JOB"], ["HOOK", "CLI"],
  ["ENGINE", "MCP"], ["MCP", "ENGINE"], ["SERVER", "WORKER"], ["JOB.TEST", "RUN-JOB"],
];
const W = (n: Node) => textWidth(n.id) + 6, BH = 9;
const at = (id: string) => NODES.find((n) => n.id === id)!;
const centre = (n: Node): [number, number] => [n.x + Math.floor(W(n) / 2), n.y + Math.floor(BH / 2)];
// The edge stops at the box edge, so the arrowhead sits outside the target.
const clip = (from: [number, number], to: Node): [number, number] => {
  const [cx, cy] = centre(to), hw = W(to) / 2 + 1, hh = BH / 2 + 1, dx = from[0] - cx, dy = from[1] - cy;
  const t = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
  return [Math.round(cx + dx * t), Math.round(cy + dy * t)];
};
const node = (d: PixelDraft, n: Node, ink: number, bg: number, label = C.ink) => { box(d, n.x, n.y, W(n), BH, ink, bg); text(d, n.x + 3, n.y + 2, n.id, label); };
const edge = (d: PixelDraft, a: string, b: string, c: number) => arrow(d, centre(at(a)), clip(centre(at(a)), at(b)), c);
const swatch = (d: PixelDraft, x: number, y: number, label: string, c: number, level: number) => {
  if (level === 4) fill(d, x, y, 4, 5, c); else dither(d, x, y, 4, 5, c, level);
  text(d, x + 6, y, label, C.ink);
};

const author = (d: PixelDraft) => {
  // 0: caption, the tarball, the cat
  d.setPass(0);
  textCentred(d, 96, 3, "TRACE THE BLAST RADIUS", C.ink, 2);
  box(d, 6, 29, 24, 15, C.ink, C.shade); text(d, 9, 31, "BASE", C.ink); text(d, 9, 37, "TAR", C.ink);
  arrow(d, [30, 36], [34, 36], C.half);
  cat(d, 4, 80, 24, "ahead");
  // 1: the index: nodes, roles, imports
  d.setPass(1);
  for (const n of NODES) node(d, n, C.ink, n.role === "test" ? C.tealTint : C.paper);
  for (const [a, b] of EDGES) edge(d, a, b, C.half);
  for (const n of NODES) if (n.role === "entry") { stroke(d, [[n.x + 1, n.y - 2], [n.x + 1, n.y - 5]], C.teal); stroke(d, [[n.x + 2, n.y - 5], [n.x + 4, n.y - 4]], C.teal); }
  // 2: the changed file lights
  d.setPass(2);
  node(d, at("REVIEW-RUN"), C.coralDeep, C.coral, C.white);
  swatch(d, 32, 100, "CHANGED", C.coral, 4);
  // 3, 4, 5: the blast spreads one importer hop at a time
  const spread = (hop: number, level: number) => {
    for (const [a, b] of EDGES) if (at(a).hop === hop && at(b).hop >= 0 && at(b).hop < hop) edge(d, a, b, C.coral);
    for (const n of NODES) if (n.hop === hop) { if (level === 4) fill(d, n.x + 1, n.y + 1, W(n) - 2, BH - 2, C.coralTint); else dither(d, n.x + 1, n.y + 1, W(n) - 2, BH - 2, C.coralTint, level); text(d, n.x + 3, n.y + 2, n.id, C.ink); }
  };
  d.setPass(3); spread(1, 4); swatch(d, 70, 100, "HOP 1", C.coralTint, 4);
  d.setPass(4); spread(2, 2); swatch(d, 100, 100, "HOP 2", C.coralTint, 2);
  d.setPass(5); spread(3, 1); swatch(d, 130, 100, "HOP 3", C.coralTint, 1);
  // 6: the flags: an untested source, a cycle
  d.setPass(6);
  const u = at("REVIEW-RUN"); text(d, u.x - 30, u.y + 2, "NO TEST", C.amber); stroke(d, [[u.x - 3, u.y + 4], [u.x - 1, u.y + 4]], C.amber);
  edge(d, "ENGINE", "MCP", C.amber); edge(d, "MCP", "ENGINE", C.amber);
  ring(d, 124, 92, 3, C.amber); text(d, 114, 80, "CYCLE", C.amber);
  // 7: the score
  d.setPass(7);
  ring(d, 172, 34, 12, C.rule); dial(d, 172, 34, 12, 0.62, C.coral, 3);
  textCentred(d, 172, 16, "RISK", C.ink); textCentred(d, 172, 29, "62", C.coral, 2); textCentred(d, 172, 49, "HIGH", C.coral);
  stroke(d, [[154, 56], [190, 56]], C.rule);
  // 8: the cat looks at the score; the counts behind it are written last
  d.setPass(8);
  cat(d, 4, 80, 24, "right");
  text(d, 156, 59, "DEPS 8", C.ink); text(d, 156, 65, "PKGS 3", C.ink); text(d, 156, 71, "ENTRY 2", C.ink);
};

export const stage05Blast = drawingFilm({
  id: "stage05Blast", title: "05 - Trace the blast radius", author,
  budgets: [8, 22, 5, 7, 7, 7, 6, 9, 6], rest: 3, seconds: 10, hold: 45,
});
