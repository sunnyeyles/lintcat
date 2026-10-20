#!/usr/bin/env bash
# Point lane.sh detach and create at worktree paths that aren't theirs (a
# plain directory, a build's worktree, a nested repo) in a scratch repo, and
# check they refuse without touching the main checkout. Also checks that
# checks.sh runs MARROW_CHECKS_FILE over a worktree's committed checks, that
# lane.sh merge writes a Tests-commit trailer that lane.sh merged reads back,
# and that create continues from origin's branch when there's no local one.
#
# Usage: ./test-lane.sh
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
not() { ! "$@"; }
is() { [[ "$1" == "$2" ]]; }

# Under a "worktrees" directory, so a loose */worktrees/* test would be fooled.
mkdir -p "$TMP/worktrees"
M="$TMP/worktrees/main"
git init -q -b main "$M"
M="$(git -C "$M" rev-parse --show-toplevel)"
git -C "$M" config user.email t@example.com
git -C "$M" config user.name t
mkdir -p "$M/.marrow"
echo 't: false' >"$M/.marrow/checks"
git -C "$M" add -A && git -C "$M" commit -qm one
A="$(git -C "$M" rev-parse HEAD)"
git -C "$M" commit -q --allow-empty -m two
B="$(git -C "$M" rev-parse HEAD)"
W="$M/.claude/worktrees"
main_untouched() { git -C "$M" symbolic-ref -q HEAD >/dev/null && is "$(git -C "$M" rev-parse HEAD)" "$B"; }

ok "detach makes a detached worktree" "$S/lane.sh" detach "$M" "$W/marrow-review-x" "$A"
ok "it's at the sha" is "$(git -C "$W/marrow-review-x" rev-parse HEAD)" "$A"
ok "detach moves a clean one" "$S/lane.sh" detach "$M" "$W/marrow-review-x" "$B"
ok "it's at the new sha" is "$(git -C "$W/marrow-review-x" rev-parse HEAD)" "$B"
echo dirty >"$W/marrow-review-x/f"
ok "detach refuses a dirty one" not "$S/lane.sh" detach "$M" "$W/marrow-review-x" "$A"
ok "and leaves it where it was" is "$(git -C "$W/marrow-review-x" rev-parse HEAD)" "$B"
rm "$W/marrow-review-x/f"

mkdir -p "$W/marrow-review-plain"
ok "detach refuses a plain directory" not "$S/lane.sh" detach "$M" "$W/marrow-review-plain" "$A"
ok "create refuses a plain directory" not "$S/lane.sh" create "$M" "$A" "$W/marrow-review-plain" marrow/review-plain
ok "the main checkout is still on its branch, at its commit" main_untouched

git -C "$M" worktree add -q -b marrow/checks-foo "$W/marrow-checks-foo" "$A"
ok "detach refuses a build's worktree that shares the name" not "$S/lane.sh" detach "$M" "$W/marrow-checks-foo" "$B"
ok "which stays on its branch" is "$(git -C "$W/marrow-checks-foo" symbolic-ref --short HEAD)" marrow/checks-foo

git init -q "$W/marrow-review-nested"
git -C "$W/marrow-review-nested" commit -q --allow-empty -m n
ok "detach refuses a nested repo" not "$S/lane.sh" detach "$M" "$W/marrow-review-nested" "$A"
ok "detach refuses a path outside .claude/worktrees/marrow-*" not "$S/lane.sh" detach "$M" "$TMP/elsewhere" "$A"
ok "the main checkout is untouched" main_untouched
ok "the exclude line is written once, to this repo" is "$(grep -c '^\.claude/worktrees/$' "$M/.git/info/exclude")" 1

echo 't: true' >"$TMP/draft"
"$S/lane.sh" detach "$M" "$W/marrow-checks-bar" "$B" >/dev/null
ok "checks.sh runs the worktree's committed checks" not "$S/checks.sh" "$W/marrow-checks-bar"
ok "MARROW_CHECKS_FILE overrides them" env MARROW_CHECKS_FILE="$TMP/draft" "$S/checks.sh" "$W/marrow-checks-bar"
ok "MARROW_CHECKS_FILE must be absolute" bash -c "cd '$TMP' && MARROW_CHECKS_FILE=draft '$S/checks.sh' '$W/marrow-checks-bar'; [[ \$? -eq 2 ]]"

# A ticket merge with its tests commit, pushed to an origin, then the local branch dropped.
git init -q --bare "$TMP/origin.git"
git -C "$M" remote add origin "$TMP/origin.git"
git -C "$M" push -q origin main
echo 't: true' >"$M/.marrow/checks"
git -C "$M" commit -qam "green checks"
git -C "$M" push -q origin main
"$S/lane.sh" create "$M" origin/main "$W/marrow-f" marrow/f >/dev/null
git -C "$M" worktree add -q -b marrow/f-t01 "$W/marrow-f-t01" marrow/f
git -C "$W/marrow-f-t01" commit -q --allow-empty -m "Add acceptance tests for one"
TC="$(git -C "$W/marrow-f-t01" rev-parse HEAD)"
git -C "$W/marrow-f-t01" commit -q --allow-empty -m "Build one"
ok "merge takes a tests commit" "$S/lane.sh" merge "$W/marrow-f" marrow/f-t01 "Merge ticket 01: one" "$TC"
git -C "$W/marrow-f-t01" commit -q --allow-empty -m "Build two"
"$S/lane.sh" merge "$W/marrow-f" marrow/f-t01 "Merge ticket 02: two" >/dev/null
ok "merged lists both tickets" is "$("$S/lane.sh" merged "$W/marrow-f" | jq -c .merged)" '["01","02"]'
ok "and the tests commit of the one that had it" is "$("$S/lane.sh" merged "$W/marrow-f" | jq -c .tests_commits)" "{\"01\":\"$TC\"}"
git -C "$W/marrow-f" push -q origin marrow/f
FHEAD="$(git -C "$W/marrow-f" rev-parse HEAD)"
"$S/lane.sh" remove "$M" "$W/marrow-f-t01" marrow/f-t01 >/dev/null 2>&1
"$S/lane.sh" remove "$M" "$W/marrow-f" marrow/f >/dev/null 2>&1
out="$("$S/lane.sh" create "$M" origin/main "$W/marrow-f" marrow/f)"
ok "create continues from origin's branch when there's no local one" is "$(jq -r .from <<<"$out")" origin
ok "at its head" is "$(git -C "$W/marrow-f" rev-parse HEAD)" "$FHEAD"
"$S/lane.sh" remove "$M" "$W/marrow-f" marrow/f >/dev/null 2>&1
git -C "$M" push -q origin main:marrow/g-t01
out="$("$S/lane.sh" create "$M" origin/main "$W/marrow-g-t01" marrow/g-t01 --fresh)"
ok "a --fresh lane ignores origin's branch" is "$(jq -r .from <<<"$out")" start

echo
if [[ $FAILS -eq 0 ]]; then echo "all passed"; else echo "$FAILS failed"; fi
[[ $FAILS -eq 0 ]]
