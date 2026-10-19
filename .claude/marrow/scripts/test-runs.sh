#!/usr/bin/env bash
# Start, find and list runs in a scratch repo with run-dir.sh and runs.sh,
# and check the folders, the .gitignore and each stage in the overview.
#
# Usage: ./test-runs.sh
set -uo pipefail

S="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
TODAY="$(date +%F)"

R="$TMP/repo"
git init -q "$R"
R="$(git -C "$R" rev-parse --show-toplevel)"

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
# has <text>: the overview has that text.
has() { "$S/runs.sh" "$R" | grep -qF -- "$1"; }
# row <run> <stage> [link]: the overview has that run at that stage.
row() { "$S/runs.sh" "$R" | grep -F "| [$1]($1/) |" | grep -qF "| $2 | ${3:-}"; }
# sees <pattern>: git status in the repo shows a matching path.
sees() { git -C "$R" status --porcelain --untracked-files=all | grep -q -- "$1"; }
# kept <run> <stage>: .marrow/README.md already has that stage, without running runs.sh.
kept() { grep -F "| [$1]($1/) |" "$R/.marrow/README.md" | grep -qF "| $2 |"; }
# at <MMDDhhmm> <file...>: set the files' times, since stages compare them.
at() { local t="2026$1.00"; shift; touch -t "$t" "$@"; }

ok "runs.sh with no .marrow/ says there are none" has "No runs yet"
ok "runs.sh with no .marrow/ writes nothing" not test -e "$R/.marrow"
ok "find with no runs fails" not "$S/run-dir.sh" find "$R" auth

A="$("$S/run-dir.sh" new "$R" auth)"
ok "new makes .marrow/<today>-<feature>" is "$A" "$R/.marrow/$TODAY-auth"
ok "new refreshes the overview itself" kept "$TODAY-auth" started
ok "new writes a .gitignore that keeps .marrow/ out of git" is "$(cat "$R/.marrow/.gitignore")" '*'
ok "git sees nothing in .marrow/" not sees .marrow
ok "find returns the run" is "$("$S/run-dir.sh" find "$R" auth)" "$A"
mkdir -p "$R/src"
ok "find works from a subdirectory" is "$("$S/run-dir.sh" find "$R/src" auth)" "$A"
ok "new refuses a feature that has a run" not "$S/run-dir.sh" new "$R" auth
ok "new refuses a bad feature name" not "$S/run-dir.sh" new "$R" "a b"
ok "new refuses a feature name a review would use" not "$S/run-dir.sh" new "$R" review-x
ok "find of another feature fails" not "$S/run-dir.sh" find "$R" au

V1="$("$S/run-dir.sh" review "$R" fix/login)"
V2="$("$S/run-dir.sh" review "$R" fix/login)"
ok "review makes .marrow/<today>-review-<slug>" is "$V1" "$R/.marrow/$TODAY-review-fix-login"
ok "a second review of the branch is a new run" is "$V2" "$R/.marrow/$TODAY-review-fix-login-2"

printf '%s\n' '*/' 'README.md' >"$R/.marrow/.gitignore"
"$S/run-dir.sh" new "$R" billing >/dev/null
ok "an existing .gitignore is left alone" is "$(cat "$R/.marrow/.gitignore")" $'*/\nREADME.md'
echo 'test: true' >"$R/.marrow/checks"
ok "with a shared .gitignore, git sees the setup files" sees .marrow/checks
ok "with a shared .gitignore, git doesn't see the runs" not sees "$TODAY-"

N="$(basename "$A")"
ok "a new run is started" row "$N" started
ls -A "$A" >"$TMP/before"
ok "approve.sh status says none" is "$("$S/approve.sh" "$A" status)" none
ok "approve.sh status writes nothing" is "$(ls -A "$A")" "$(cat "$TMP/before")"
printf '%s\n' '# Spec: Passwordless | login' '' '## Acceptance criteria' '' '- AC1: Given x, when y, then z.' '' '## Open questions' '' 'None' >"$A/spec.md"
ok "a spec is drafted, its title is the What" has '| Passwordless \| login |'
ok "spec drafted" row "$N" "spec drafted"
"$S/approve.sh" "$A" spec >/dev/null
ok "approve.sh spec refreshes the overview itself" kept "$N" "spec approved"
printf '\n## Notes\n\nMore.\n' >>"$A/spec.md"
ok "spec changed since approval" row "$N" "spec changed since approval"
"$S/approve.sh" "$A" spec >/dev/null
cat >"$A/plan.json" <<'JSON'
{"feature": "auth", "lanes": 1, "criteria": [{"id": "AC1", "text": "t", "verify": "auto"}],
 "tickets": [{"id": "01", "title": "Do it", "goal": "g", "criteria": ["AC1"], "blocked_by": [], "owns": ["src/**"],
   "tests": {"paths": ["src/a.test.ts"], "helpers": [], "command": "true"}, "difficulty": "normal", "steps": ["s"], "human_steps": [], "notes": ""}]}
JSON
ok "plan drafted" row "$N" "plan drafted"
ok "approve.sh plan passes" "$S/approve.sh" "$A" plan
ok "plan approved" row "$N" "plan approved"
cp "$A/plan.json" "$TMP/plan.json"
echo ' ' >>"$A/plan.json"
ok "plan changed since approval" row "$N" "plan changed since approval"
cp "$TMP/plan.json" "$A/plan.json"
ok "an empty build-args.json, from a failed build-args.sh, isn't a build" bash -c ": >'$A/build-args.json' && '$S/runs.sh' '$R' | grep -F '[$N]' | grep -qF '| plan approved |'"
rm "$A/build-args.json"

echo '{"session_url": "https://claude.ai/code/s1"}' >"$A/cloud.json"
at 01011000 "$A/cloud.json"
ok "building, with the session link" row "$N" building "[session](https://claude.ai/code/s1) |"
echo '{"status": "red"}' >"$A/result.json"
at 01011100 "$A/result.json"
ok "built" row "$N" "built: red"
at 01011200 "$A/cloud.json"
ok "a rebuild over the last result is building" row "$N" building
at 01011200 "$A/result.json"
ok "a rebuild in the same second as the last result is building" row "$N" building
rm "$A/cloud.json"
echo '{}' >"$A/build-args.json"
at 01011300 "$A/build-args.json"
ok "a build here is building, with no session link" row "$N" building " |"
echo '{"status": "green"}' >"$A/result.json"
at 01011400 "$A/result.json"
ok "built here" row "$N" "built: green"
echo '{"pr": "https://github.com/o/r/pull/7"}' >"$A/published.json"
at 01011300 "$A/published.json"
ok "published in the same second the build started still counts" row "$N" published "[PR](https://github.com/o/r/pull/7) |"
at 01011500 "$A/build-args.json"
ok "a rebuild after publishing is building" row "$N" building
ok "a review without a report is reviewing" row "$(basename "$V1")" reviewing
echo report >"$V1/report.md"
ok "a review with a report is reviewed" row "$(basename "$V1")" reviewed

mkdir "$R/.marrow/2020-01-01-old"
"$S/runs.sh" "$R" >"$TMP/out"
ok "runs.sh writes the overview to .marrow/README.md" cmp -s "$TMP/out" "$R/.marrow/README.md"
ok "the oldest run is last" is "$(grep '^| \[' "$TMP/out" | tail -n 1 | cut -d'|' -f2)" " [2020-01-01-old](2020-01-01-old/) "

echo
if [[ $FAILS -eq 0 ]]; then echo "all passed"; else echo "$FAILS failed"; fi
[[ $FAILS -eq 0 ]]
