#!/usr/bin/env bash
# List UI files with ui-files.sh in a scratch repo: which extensions count,
# deleted files, an empty list, .ts in a UI package and not in a backend
# package, and bad arguments.
#
# Usage: ./test-ui-files.sh
set -uo pipefail

S="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

R="$TMP/repo"
git init -q "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
mkdir -p "$R/src"
touch "$R/src/old.tsx" "$R/src/api.ts"
git -C "$R" add -A
git -C "$R" commit -q -m base
BASE="$(git -C "$R" rev-parse HEAD)"

# ok <description> <command...>: passes when the command succeeds.
ok() {
  local what="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS $what"
  else
    echo "FAIL $what"
    FAILS=$((FAILS + 1))
  fi
}
not() { ! "$@"; }
is() { [[ "$1" == "$2" ]]; }
files() { "$S/ui-files.sh" "$R" "$BASE" "$1" | jq -c .files; }

echo x >>"$R/src/api.ts"
git -C "$R" commit -q -am "server only"
SERVER="$(git -C "$R" rev-parse HEAD)"
ok "a diff with no UI files lists none" is "$(files "$SERVER")" '[]'
ok "and says ok" is "$("$S/ui-files.sh" "$R" "$BASE" "$SERVER" | jq .ok)" true

touch "$R/src/Page.tsx" "$R/src/Card.JSX" "$R/src/app.vue" "$R/src/site.scss" "$R/src/util.js"
git -C "$R" rm -q "$R/src/old.tsx"
git -C "$R" add -A
git -C "$R" commit -q -m ui
UI="$(git -C "$R" rev-parse HEAD)"
ok "it lists the UI files, any case, and not .ts or .js" is "$(files "$UI")" '["src/Card.JSX","src/Page.tsx","src/app.vue","src/site.scss"]'

mkdir -p "$R/web/src/hooks" "$R/web/lib" "$R/web/e2e" "$R/api/src"
echo '{"dependencies": {"next": "15.0.0", "react": "19.0.0"}}' >"$R/web/package.json"
echo '{"dependencies": {"express": "5.0.0"}}' >"$R/api/package.json"
git -C "$R" add -A
git -C "$R" commit -q -m packages
PKGS="$(git -C "$R" rev-parse HEAD)"
touch "$R/web/src/hooks/useCart.ts" "$R/web/lib/api.ts" "$R/web/next.config.mjs" "$R/web/lib/api.test.ts" \
  "$R/web/src/Cart.stories.ts" "$R/web/e2e/cart.ts" "$R/web/playwright.config.ts" "$R/api/src/server.ts"
echo '{"dependencies": {"express": "5.1.0"}}' >"$R/api/package.json"
echo '{"dependencies": {"next": "15.1.0", "react": "19.0.0"}}' >"$R/web/package.json"
git -C "$R" add -A
git -C "$R" commit -q -m scripts
SCRIPTS="$(git -C "$R" rev-parse HEAD)"
ok "in a UI package it lists .ts, .mjs and package.json, not tests, stories, e2e or test configs" \
  is "$("$S/ui-files.sh" "$R" "$PKGS" "$SCRIPTS" | jq -c .files)" '["web/lib/api.ts","web/next.config.mjs","web/package.json","web/src/hooks/useCart.ts"]'

ok "it refuses missing arguments" not "$S/ui-files.sh" "$R" "$BASE"
ok "it fails on a bad revision" not "$S/ui-files.sh" "$R" "$BASE" nope

echo
if [[ $FAILS -eq 0 ]]; then echo "all passed"; else echo "$FAILS failed"; fi
[[ $FAILS -eq 0 ]]
