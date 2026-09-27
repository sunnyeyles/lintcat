// Decodes each rendered file and counts pixels outside the film's palette; exits 1 on any.
//   node check-palette.mjs out/a.gif out/b.png   (needs ffmpeg on PATH or in $FFMPEG)
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { PALETTE } = await import(join(HERE, ".work/src/canvas-core/lintcatReviewPalette.ts"));
const allowed = new Set(PALETTE.map((h) => parseInt(h.slice(1), 16)));
const ffmpeg = process.env.FFMPEG || "ffmpeg";

let failed = false;
for (const file of process.argv.slice(2)) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error(`${file}: ffmpeg failed\n${r.stderr}`); failed = true; continue; }
  const px = r.stdout;
  let off = 0;
  const seen = new Set();
  for (let i = 0; i + 2 < px.length; i += 3) {
    const c = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    if (!allowed.has(c)) { off++; seen.add(c); }
  }
  const total = px.length / 3;
  console.log(`${file}: ${off} off-palette px of ${total}${off ? "  e.g. " + [...seen].slice(0, 5).map((c) => "#" + c.toString(16).padStart(6, "0")).join(" ") : ""}`);
  if (off) failed = true;
}
process.exit(failed ? 1 : 0);
