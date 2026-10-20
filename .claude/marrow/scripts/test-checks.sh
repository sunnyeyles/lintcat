#!/usr/bin/env bash
# Run checks.sh twice in a scratch npm repo with a fake npm, and check that a
# detected install is skipped while its lockfile and node_modules are
# unchanged, reruns when either changes or the last one failed, and that a
# "!" step from .marrow/checks runs every time.
#
# Usage: ./test-checks.sh
set -uo pipefail

S="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

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
is() { [[ "$1" == "$2" ]]; }

# The fake npm logs each install; "npm ci" makes node_modules, or fails with NPM_FAIL set.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/npm" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == ci ]]; then
  echo ci >>"$NPM_LOG"
  [[ -n "${NPM_FAIL:-}" ]] && exit 1
  mkdir -p node_modules
fi
exit 0
SH
chmod +x "$TMP/bin/npm"
export PATH="$TMP/bin:$PATH" NPM_LOG="$TMP/npm.log"
: >"$NPM_LOG"

R="$TMP/repo"
git init -q "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
echo '{"scripts": {"test": "true"}}' >"$R/package.json"
echo '{"lockfileVersion": 3}' >"$R/package-lock.json"
echo node_modules >"$R/.gitignore"
git -C "$R" add -A
git -C "$R" commit -q -m base

installs() { wc -l <"$NPM_LOG" | tr -d ' '; }
run() { "$S/checks.sh" "$R" 2>/dev/null; }

ok "the first run is green" run
ok "and installs" is "$(installs)" 1
ok "the second run is green" run
ok "and skips the install" is "$(installs)" 1

echo '{"lockfileVersion": 3, "packages": {}}' >"$R/package-lock.json"
git -C "$R" commit -q -am "new lockfile"
run >/dev/null
ok "a changed lockfile installs again" is "$(installs)" 2

rm -rf "$R/node_modules"
run >/dev/null
ok "a missing node_modules installs again" is "$(installs)" 3

echo '{"lockfileVersion": 3, "packages": {"": {}}}' >"$R/package-lock.json"
git -C "$R" commit -q -am "another lockfile"
ok "a failed install is red" bash -c "NPM_FAIL=1 '$S/checks.sh' '$R' 2>/dev/null; [[ \$? -eq 1 ]]"
run >/dev/null
ok "and the next run installs again" is "$(installs)" 5
run >/dev/null
ok "then skips it" is "$(installs)" 5

mkdir -p "$R/.marrow"
printf '!install: npm ci\ntest: npm run test\n' >"$R/.marrow/checks"
git -C "$R" add -A
git -C "$R" commit -q -m "own checks"
run >/dev/null
run >/dev/null
ok "a ! step from .marrow/checks runs every time" is "$(installs)" 7

echo
if [[ $FAILS -eq 0 ]]; then echo "all passed"; else echo "$FAILS failed"; fi
[[ $FAILS -eq 0 ]]
