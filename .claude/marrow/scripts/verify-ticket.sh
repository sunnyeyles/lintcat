#!/usr/bin/env bash
# Check one ticket's work in a worktree, outside the agent that did it.
#
# Usage:
#   verify-ticket.sh red   <worktree> <plan.json> <ticket-id> <base>
#   verify-ticket.sh green <worktree> <plan.json> <ticket-id> <tests-commit>
#
# red:   after the test writer. base..HEAD may touch only the ticket's test
#        paths, helpers and (for compile stubs) owned paths, every test file
#        must exist, and the test command must fail (a test that passes before
#        the code exists proves nothing). "head" is the tests commit.
# green: after an implementer. The test command must pass, the test files
#        must be byte-identical to <tests-commit>, every file changed since
#        <tests-commit> must be inside the ticket's owned paths, and the tree
#        must be clean.
# Prints JSON; exit 0 when the check holds, 1 when it doesn't, 2 on misuse.
set -uo pipefail

MODE="${1:-}" WT="${2:-}" PLAN="${3:-}" TID="${4:-}" REF="${5:-}"
if [[ ! "$MODE" =~ ^(red|green)$ || -z "$WT" || ! -f "$PLAN" || -z "$TID" || -z "$REF" ]]; then
  echo "usage: verify-ticket.sh red|green <worktree> <plan.json> <ticket-id> <ref>" >&2
  exit 2
fi
TICKET="$(jq -c --arg id "$TID" '.tickets[] | select(.id == $id)' "$PLAN")"
[[ -n "$TICKET" ]] || { echo "no ticket $TID in $PLAN" >&2; exit 2; }
git -C "$WT" rev-parse --verify -q "$REF^{commit}" >/dev/null || { echo "bad ref $REF" >&2; exit 2; }

CMD="$(jq -r '.tests.command // ""' <<<"$TICKET")"
LOG="$(mktemp "${TMPDIR:-/tmp}/marrow-verify-$TID.XXXXXX")"
rc=0
if [[ -n "$CMD" ]]; then
  (cd "$WT" && CI=true bash -o pipefail -c "$CMD") >"$LOG" 2>&1
  rc=$?
else
  echo "no test command (manual criteria only)" >"$LOG"
fi
CHANGED="$(git -C "$WT" diff --name-only "$REF" HEAD | jq -R . | jq -s .)"
DIRTY="$(git -C "$WT" status --porcelain | jq -R . | jq -s .)"

HEAD_SHA="$(git -C "$WT" rev-parse HEAD)"
export MODE TICKET CHANGED DIRTY rc CMD LOG HEAD_SHA
python3 - <<'PY'
import json
import os
import re
import subprocess
import sys

mode, t = os.environ["MODE"], json.loads(os.environ["TICKET"])
changed, dirty = json.loads(os.environ["CHANGED"]), json.loads(os.environ["DIRTY"])
rc, cmd, log = int(os.environ["rc"]), os.environ["CMD"], os.environ["LOG"]
tests = t.get("tests") or {}

def glob_re(g):
    out, i = "", 0
    while i < len(g):
        if g.startswith("**/", i): out += "(?:.*/)?"; i += 3
        elif g.startswith("**", i): out += ".*"; i += 2
        elif g[i] == "*": out += "[^/]*"; i += 1
        elif g[i] == "?": out += "[^/]"; i += 1
        else: out += re.escape(g[i]); i += 1
    return re.compile(out + r"\Z")

def inside(p, globs):
    return any(glob_re(g).match(p) for g in globs)

lines = open(log, encoding="utf-8", errors="replace").read().splitlines()
tail = "\n".join([l for l in lines if l.strip()][-60:])
problems = []
test_files = tests.get("paths", [])
allowed_tests = test_files + tests.get("helpers", [])

if mode == "red":
    stray = [p for p in changed if not inside(p, allowed_tests + t.get("owns", []))]
    if stray:
        problems.append("the test writer changed files outside the test paths: %s" % ", ".join(stray))
    missing = [p for p in test_files if p not in changed]
    if missing:
        problems.append("test files not written: %s" % ", ".join(missing))
    if cmd and rc == 0:
        problems.append("the tests pass before any implementation, so they don't test the new behaviour")
    out = {"ok": not problems, "mode": "red", "test_exit": rc, "changed": changed}
else:
    locked = [p for p in changed if p in test_files]
    stray = [p for p in changed if p not in test_files and not inside(p, t.get("owns", []))]
    if cmd and rc != 0:
        problems.append("the ticket's tests fail (exit %d)" % rc)
    if locked:
        problems.append("locked test files were changed: %s" % ", ".join(locked))
    if stray:
        problems.append("files changed outside the owned paths: %s" % ", ".join(stray))
    if dirty:
        problems.append("uncommitted changes left in the worktree")
    out = {"ok": not problems, "mode": "green", "test_exit": rc, "locked_changed": locked,
           "out_of_scope": stray, "dirty": dirty, "changed": changed}

if mode == "red" and dirty:
    problems.append("uncommitted changes left in the worktree")
    out["ok"] = False
out.update({"ticket": t["id"], "head": os.environ["HEAD_SHA"], "command": cmd, "problems": problems, "log": log, "tail": tail if problems else ""})
print(json.dumps(out, indent=2))
sys.exit(0 if not problems else 1)
PY
