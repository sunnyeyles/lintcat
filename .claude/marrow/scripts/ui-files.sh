#!/usr/bin/env bash
# List the UI files a branch's diff adds or changes, so the workflows run the
# UI reviewer only when there are some.
#
# Usage:
#   ui-files.sh <worktree> <base> <head>
#
# UI files are .jsx .tsx .vue .svelte .astro .mdx .html .css .scss .sass .less,
# plus .ts .js .mts .mjs .cts .cjs files and package.json in a UI package: one
# whose nearest package.json (at <head>) depends on a UI framework, such as
# react, next or vue. Tests, stories, mocks and test-runner configs there
# don't count, and neither do deleted files. Prints {"ok": true, "files":
# [...]} with paths relative to the repo root. Exit 0 listed (the list may be
# empty), 1 failed.
set -euo pipefail

WT="${1:-}" BASE="${2:-}" HEAD="${3:-}"
if [[ -z "$WT" || -z "$BASE" || -z "$HEAD" ]]; then
  echo "usage: ui-files.sh <worktree> <base> <head>" >&2
  exit 1
fi

UI_EXT='\.(jsx|tsx|vue|svelte|astro|mdx|html|css|scss|sass|less)$'
SCRIPT_EXT='(\.(ts|js|mts|mjs|cts|cjs)|(^|/)package\.json)$'
NOT_UI='\.(test|spec|stories)\.|(^|/)(__tests__|__mocks__|e2e)/|(^|/)(playwright|vitest|jest|cypress)\.config\.'
FRAMEWORKS='["react","next","vue","nuxt","svelte","@sveltejs/kit","solid-js","preact","astro","@angular/core","@remix-run/react"]'

# ui_package <dir>: the nearest package.json at or above <dir> depends on a UI framework.
ui_package() {
  local d="$1" pj
  while :; do
    pj="${d:+$d/}package.json"
    if git -C "$WT" cat-file -e "$HEAD:$pj" 2>/dev/null; then
      git -C "$WT" show "$HEAD:$pj" | jq -e --argjson fw "$FRAMEWORKS" \
        '[.dependencies, .devDependencies] | map(. // {} | keys) | add | any(. as $k | $fw | index($k))' >/dev/null 2>&1
      return
    fi
    [[ -z "$d" ]] && return 1
    [[ "$d" == */* ]] && d="${d%/*}" || d=""
  done
}

names="$(git -C "$WT" diff --name-only --diff-filter=d "$BASE...$HEAD")"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if grep -qiE "$UI_EXT" <<<"$f"; then
    echo "$f"
  elif grep -qE "$SCRIPT_EXT" <<<"$f" && ! grep -qE "$NOT_UI" <<<"$f"; then
    dir=""
    [[ "$f" == */* ]] && dir="${f%/*}"
    if ui_package "$dir"; then echo "$f"; fi
  fi
done <<<"$names" | jq -R -s -c '{ok: true, files: (split("\n") | map(select(length > 0)))}'
