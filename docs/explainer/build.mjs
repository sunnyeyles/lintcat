// Builds every stage: scaffold the anidoodle engine into .build/, overlay src/, render, verify,
// and copy the deliverables into apps/web/public/explainer/. Usage: pnpm explainer [stage...]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const BUILD = join(HERE, ".build");
const OUT = join(ROOT, "apps/web/public/explainer");
const SCALE = process.env.EXPLAINER_SCALE ?? "0.5";

const findEngine = () => {
  if (process.env.ANIDOODLE_ENGINE) return process.env.ANIDOODLE_ENGINE;
  const cache = join(process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR ?? join(homedir(), ".claude/plugins/cache"), "alexgreensh-anidoodle/anidoodle");
  const versions = existsSync(cache) ? readdirSync(cache).sort() : [];
  const engine = versions.length ? join(cache, versions[versions.length - 1], "skills/anidoodle/engine") : null;
  if (!engine || !existsSync(engine)) throw new Error("anidoodle engine not found: install the plugin (see docs/explainer/README.md) or set ANIDOODLE_ENGINE");
  return engine;
};

const run = (cmd, args, cwd = BUILD) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
};
const capture = (cmd, args, cwd = BUILD) => execFileSync(cmd, args, { cwd, encoding: "utf8" });

const STILLS = process.argv.includes("--stills");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const stages = readdirSync(join(HERE, "src/canvas-core")).filter((f) => /^stage\d\d\w+\.ts$/.test(f)).map((f) => f.replace(/\.ts$/, ""));
const wanted = args.length ? stages.filter((s) => args.some((w) => s.includes(w))) : stages;
if (!wanted.length) throw new Error(`no stage matches ${args.join(" ")}; have ${stages.join(", ")}`);

if (!existsSync(join(BUILD, "tools/render.mjs"))) {
  const engine = findEngine();
  console.log(`scaffolding from ${engine}`);
  run("node", [join(engine, "tools/scaffold.mjs"), BUILD, "--format", "16x9"], ROOT);
}
cpSync(join(HERE, "src"), join(BUILD, "src"), { recursive: true });
if (!existsSync(join(BUILD, "node_modules"))) run("npm", ["install", "--no-audit", "--no-fund", "--omit=optional"]);
// The MP4 needs libx264; Playwright's bundled ffmpeg lacks it, so a static build is fetched into .build.
const ffmpegBin = join(BUILD, "node_modules/ffmpeg-static/ffmpeg");
const ffprobeDir = join(BUILD, "node_modules/ffprobe-static/bin", process.platform, process.arch);
const needFfmpeg = !process.env.FFMPEG && spawnSync("ffmpeg", ["-version"]).status !== 0;
const needFfprobe = spawnSync("ffprobe", ["-version"]).status !== 0;
if ((needFfmpeg && !existsSync(ffmpegBin)) || (needFfprobe && !existsSync(join(ffprobeDir, "ffprobe")))) {
  run("npm", ["install", "--no-save", "--no-audit", "--no-fund", "ffmpeg-static", "ffprobe-static"]);
}
if (needFfmpeg) { process.env.FFMPEG = ffmpegBin; process.env.PATH = `${dirname(ffmpegBin)}:${process.env.PATH}`; }
if (needFfprobe) process.env.PATH = `${ffprobeDir}:${process.env.PATH}`;
mkdirSync(OUT, { recursive: true });

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
for (const stage of wanted) {
  const id = kebab(stage), frames = Number(readFileSync(join(HERE, "src/canvas-core", `${stage}.ts`), "utf8").match(/seconds:\s*(\d+)/)?.[1] ?? 8) * 30;
  console.log(`\n=== ${stage} -> ${id}`);
  const png = STILLS ? join(BUILD, "out", `${id}.png`) : join(OUT, `${id}.png`);
  const still = capture("node", ["tools/still.mjs", stage, "--frame", String(frames - 1), "--scale", SCALE, "--out", png]);
  process.stdout.write(still);
  if (!still.includes("reproducible")) throw new Error(`${stage}: still is not reproducible`);
  if (STILLS) continue;
  run("node", ["tools/render.mjs", stage, "--scale", SCALE, "--out", join(OUT, `${id}.mp4`)]);
  run("node", ["tools/gate.mjs", stage, "--scale", SCALE, "--mp4", join(OUT, `${id}.mp4`)]);
  run("node", ["tools/emit.mjs", stage, "--out", join(OUT, `${id}.html`)]);
}
console.log(`\ndone: ${wanted.length} stage(s) in ${OUT}`);
