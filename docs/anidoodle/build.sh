#!/usr/bin/env bash
# Rebuilds the how-it-works film from docs/anidoodle/src with the anidoodle engine at a pinned commit.
#   bash docs/anidoodle/build.sh [setup|render|all]   (default: all)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ENGINE_URL=https://github.com/alexgreensh/anidoodle.git
ENGINE_SHA=03ddf534328962f8a91eb115e3ae67e03da4de5a
ENGINE="$HERE/.engine"
WORK="$HERE/.work"
TOOLS="$HERE/.tools"
OUT="$REPO/apps/web/public/how-it-works"
FILM=lintcatReview
PHASE="${1:-all}"

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
[ -f /root/.ccr/ca-bundle.crt ] && export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-/root/.ccr/ca-bundle.crt}"

say() { printf '\n== %s\n' "$*"; }

setup() {
  say "engine at $ENGINE_SHA"
  if [ "$(git -C "$ENGINE" rev-parse HEAD 2>/dev/null || true)" != "$ENGINE_SHA" ]; then
    rm -rf "$ENGINE"; mkdir -p "$ENGINE"; git -C "$ENGINE" init -q
    if ! git -C "$ENGINE" fetch -q --depth 1 "$ENGINE_URL" "$ENGINE_SHA"; then
      git -C "$ENGINE" fetch -q --depth 200 "$ENGINE_URL" main
    fi
    git -C "$ENGINE" checkout -q --detach "$ENGINE_SHA"
  fi

  say "project: engine tree + our source"
  node "$ENGINE/skills/anidoodle/engine/tools/scaffold.mjs" "$WORK" >/dev/null
  cp -R "$HERE/src/." "$WORK/src/"

  say "dependencies: the three the tools need, pinned to the engine lock's versions"
  cd "$WORK"
  node -e '
    const fs = require("fs"), lock = require("./package-lock.json").packages, pin = (n) => lock["node_modules/" + n].version;
    const deps = Object.fromEntries(["esbuild", "playwright-core", "typescript"].map((n) => [n, pin(n)]));
    fs.writeFileSync("package.json", JSON.stringify({ name: "lintcat-anidoodle-work", private: true, type: "module", dependencies: deps }, null, 2));
    const ts = JSON.parse(fs.readFileSync("tsconfig.json", "utf8"));
    ts.compilerOptions.paths = { "anidoodle-engine/*": ["./src/*"] };
    fs.writeFileSync("tsconfig.json", JSON.stringify(ts, null, 2));
  '
  rm -f package-lock.json
  [ -d node_modules ] || npm install --no-audit --no-fund
  node -e 'require("esbuild"); require("playwright-core")'

  say "full ffmpeg + ffprobe on PATH"
  if ! ffmpeg_ok; then
    mkdir -p "$TOOLS/bin"
    [ -f "$TOOLS/package.json" ] || echo '{ "name": "lintcat-anidoodle-tools", "private": true }' > "$TOOLS/package.json"
    (cd "$TOOLS" && npm i --no-audit --no-fund ffmpeg-static ffprobe-static)
    ln -sf "$(cd "$TOOLS" && node -p 'require("ffmpeg-static")')" "$TOOLS/bin/ffmpeg"
    ln -sf "$(cd "$TOOLS" && node -p 'require("ffprobe-static").path')" "$TOOLS/bin/ffprobe"
  fi
  tools_env
  ffmpeg_ok || { echo "no gif encoder in $(command -v ffmpeg); install a full ffmpeg (apt-get install -y ffmpeg)"; exit 1; }
  ffmpeg -hide_banner -version | head -1
}

tools_env() {
  [ -d "$TOOLS/bin" ] && export PATH="$TOOLS/bin:$PATH"
  export FFMPEG="$(command -v ffmpeg || true)"
}

ffmpeg_ok() {
  command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1 || return 1
  local enc; enc="$(ffmpeg -hide_banner -encoders 2>/dev/null)"
  grep -qE '^ .{6} gif ' <<<"$enc" && grep -q libx264 <<<"$enc"
}

render() {
  tools_env
  cd "$WORK"
  cp -R "$HERE/src/." "$WORK/src/"
  say "typecheck"
  npx tsc --noEmit -p tsconfig.json
  say "smoke still"
  node tools/still.mjs $FILM --shot check --frame 660 --scale 2 --out out/look.png
  say "mp4 (the gate's input)"
  node tools/render.mjs $FILM
  say "gate"
  node tools/gate.mjs $FILM
  say "gif"
  node tools/render.mjs $FILM --scale 0.4 --width 768 --gif-fps 10 --out out/lintcat-review.gif
  say "poster"
  node tools/still.mjs $FILM --shot payoff --frame 1049 --scale 0.4 --out out/lintcat-review-poster.png
  say "player"
  node tools/emit.mjs $FILM --out out/lintcat-review.html
  say "palette"
  node "$HERE/check-palette.mjs" out/lintcat-review.gif out/lintcat-review-poster.png
  say "publish"
  mkdir -p "$OUT"
  cp out/lintcat-review.gif out/lintcat-review-poster.png out/lintcat-review.html "$OUT/"
  ls -l "$OUT"
}

case "$PHASE" in
  setup) setup ;;
  render) render ;;
  all) setup; render ;;
  *) echo "usage: build.sh [setup|render|all]"; exit 2 ;;
esac
