// Renders the LintCat loop with anidoodle pinned to one commit, then copies the GIF and poster into place.
//   node docs/anidoodle/render.mjs [--no-gate]
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const REPO = "https://github.com/alexgreensh/anidoodle";
const SHA = "03ddf534328962f8a91eb115e3ae67e03da4de5a";
const ENGINE = join(HERE, ".engine");
const SKILL = join(ENGINE, "plugins/anidoodle/skills/anidoodle/engine");
const PROJECT = join(ENGINE, "project");
const FILM = "lintcatLoop";
const GIF_LIMIT = 1.5 * 1024 * 1024;
const gate = !process.argv.includes("--no-gate");

const run = (cmd, args, cwd, env = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, COREPACK_ENABLE_STRICT: "0", ...env } });
  if (r.status !== 0) {
    console.error(`render: ${cmd} ${args.join(" ")} failed in ${cwd}`);
    process.exit(r.status ?? 1);
  }
};

if (!existsSync(join(SKILL, "tools/scaffold.mjs"))) {
  mkdirSync(ENGINE, { recursive: true });
  run("git", ["init", "-q"], ENGINE);
  run("git", ["fetch", "-q", "--depth", "1", REPO, SHA], ENGINE);
  run("git", ["checkout", "-q", "--detach", "FETCH_HEAD"], ENGINE);
}
if (!existsSync(join(PROJECT, "package.json"))) {
  const scaffold = join(SKILL, "tools/scaffold.mjs");
  run("node", [scaffold, PROJECT, "--film", FILM, "--format", "16x9", "--duration", "10", "--fps", "30", "--bpm", "120"], HERE);
}
// `anidoodle/<dir>/<module>` names an engine module; in the project it sits one level up from ours.
for (const file of ["canvas-core/lintcatLoop.ts", "hosts/page-lintcatLoop.ts"]) {
  const code = readFileSync(join(HERE, "src", file), "utf8").replaceAll('"anidoodle/', '"../');
  writeFileSync(join(PROJECT, "src", file), code);
}
if (!existsSync(join(PROJECT, "node_modules/ffprobe-static"))) {
  run("npm", ["install", "--no-audit", "--no-fund", "ffmpeg-static@5", "ffprobe-static@3"], PROJECT);
}

// Playwright's own ffmpeg build cannot decode PNG, so the static builds go first on PATH.
const bin = join(PROJECT, "bin");
const req = createRequire(join(PROJECT, "package.json"));
mkdirSync(bin, { recursive: true });
for (const [name, target] of [["ffmpeg", req("ffmpeg-static")], ["ffprobe", req("ffprobe-static").path]]) {
  rmSync(join(bin, name), { force: true });
  symlinkSync(target, join(bin, name));
}
const env = { PATH: `${bin}:${process.env.PATH}`, FFMPEG: join(bin, "ffmpeg") };
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";

const scale = ["--scale", "0.5"];
run("node", ["tools/render.mjs", FILM, ...scale], PROJECT, env);
if (gate) run("node", ["tools/gate.mjs", FILM, ...scale], PROJECT, env);
run("node", ["tools/render.mjs", FILM, ...scale, "--out", "out/how-it-works.gif", "--gif-fps", "10"], PROJECT, env);
run("node", ["tools/still.mjs", FILM, ...scale, "--frame", "180", "--out", "out/how-it-works.png"], PROJECT, env);

const gif = join(PROJECT, "out/how-it-works.gif");
const size = statSync(gif).size;
if (size > GIF_LIMIT) {
  console.error(`render: GIF is ${(size / 1024).toFixed(0)} KB, over the ${GIF_LIMIT / 1024} KB budget`);
  process.exit(1);
}
// The README embeds only the GIF; the dashboard also shows the poster to reduced-motion readers.
const targets = [
  [join(ROOT, "docs/assets"), "lintcat-how-it-works", ["gif"]],
  [join(ROOT, "apps/web/public/brand"), "how-it-works", ["gif", "png"]],
];
for (const [dir, base, exts] of targets) {
  mkdirSync(dir, { recursive: true });
  for (const ext of exts) {
    copyFileSync(join(PROJECT, `out/how-it-works.${ext}`), join(dir, `${base}.${ext}`));
  }
  console.log(`wrote ${join(dir, base)}.{${exts.join(",")}}`);
}
console.log(`gif ${(size / 1024).toFixed(0)} KB`);
