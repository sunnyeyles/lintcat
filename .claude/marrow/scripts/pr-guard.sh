#!/usr/bin/env bash
# Block a PR that carries AI attribution, in its title, its body or on any of
# its commits.
#
# Usage:
#   pr-guard.sh <repo-path> <title> <body-file> <base> [head]
#
# head defaults to HEAD. Checks the title, the body file, every commit message
# in base..head, and each commit's author and committer. Prints JSON; exit 0
# when clean, 1 on a hit, 2 on misuse.
set -euo pipefail

usage() {
  [[ -n "${1:-}" ]] && echo "pr-guard.sh: $1" >&2
  echo "usage: pr-guard.sh <repo-path> <title> <body-file> <base> [head]" >&2
  exit 2
}

REPO_PATH="${1:-}"
TITLE="${2:-}"
BODY="${3:-}"
[[ -n "$REPO_PATH" && -n "$TITLE" && -n "$BODY" && -n "${4:-}" && -e "$REPO_PATH/.git" && -f "$BODY" ]] || usage
BASE_SHA="$(git -C "$REPO_PATH" rev-parse --verify -q "$4^{commit}")" || usage "bad base ref: $4"
HEAD_SHA="$(git -C "$REPO_PATH" rev-parse --verify -q "${5:-HEAD}^{commit}")" || usage "bad head ref: ${5:-HEAD}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# One record per commit, NUL-separated, so multi-line messages stay whole.
git -C "$REPO_PATH" log -z --format='%H%n%an <%ae>%n%cn <%ce>%n%B' "$BASE_SHA..$HEAD_SHA" >"$TMP/commits"

export TITLE BODY TMP
python3 - <<'PY'
import json
import os
import re
import sys

PATTERN = re.compile(r"Claude Code|claude\.ai|claude\.com|Co-Authored-By:\s*Claude|\U0001F916|noreply@anthropic\.com", re.I)

hits = []
if PATTERN.search(os.environ["TITLE"]):
    hits.append({"where": "PR title", "text": os.environ["TITLE"][:200]})
with open(os.environ["BODY"], encoding="utf-8", errors="replace") as f:
    for n, line in enumerate(f, 1):
        if PATTERN.search(line):
            hits.append({"where": "PR body line %d" % n, "text": line.strip()[:200]})

commits = 0
with open(os.path.join(os.environ["TMP"], "commits"), encoding="utf-8", errors="replace") as f:
    for rec in f.read().split("\0"):
        rec = rec.strip("\n")
        if not rec:
            continue
        commits += 1
        lines = rec.split("\n")
        sha = lines[0][:12]
        for label, line in (("author", lines[1]), ("committer", lines[2])):
            if PATTERN.search(line) or re.search(r"\bclaude\b", line, re.I):
                hits.append({"where": "commit %s %s" % (sha, label), "text": line})
        for line in lines[3:]:
            if PATTERN.search(line):
                hits.append({"where": "commit %s message" % sha, "text": line.strip()[:200]})

print(json.dumps({"ok": not hits, "commits_checked": commits, "hits": hits}, indent=2))
sys.exit(1 if hits else 0)
PY
