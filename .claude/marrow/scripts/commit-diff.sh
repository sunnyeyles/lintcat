#!/usr/bin/env bash
# PostToolUse Bash hook for the marrow agents that commit. Reads the hook JSON
# on stdin. When the command made a commit and the session runs inside cmux,
# opens that commit in `cmux diff`. The first diff opens a new "Commit diffs"
# workspace in the sidebar; each later one opens as a new tab in it. Closing
# the workspace starts over with a new one on the next commit.
#
# Usage (agent frontmatter):
#   commit-diff.sh
#
# Does nothing outside cmux (a cloud session, a plain terminal), for commands
# with no `git commit`, and when HEAD was already shown or wasn't committed in
# the last 5 minutes. Always exits 0: a diff that won't open never blocks an
# agent.
set -uo pipefail

[[ -n "${CMUX_SURFACE_ID:-}" ]] || exit 0
for bin in cmux git jq python3; do
  command -v "$bin" >/dev/null 2>&1 || exit 0
done

# The diff workspace's id and the id of the pane holding its tabs, on one line.
# UUIDs, not refs: cmux reuses refs after a restart.
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/marrow/diff-workspace"

# show_diff <title>: shows the patch on stdin as a tab in the diff workspace,
# creating the workspace first if there isn't one.
show_diff() {
  local title="$1" ws="" pane="" src out
  read -r ws pane <"$STATE" 2>/dev/null
  # Empty ids would fall back to the caller's workspace, so check them first.
  if [[ -n "$ws" && -n "$pane" ]] && out="$(cmux list-pane-surfaces --workspace "$ws" --pane "$pane" --json 2>/dev/null)"; then
    src="$(jq -r '.surfaces[0].id // empty' <<<"$out")"
    # cmux diff always opens a split; moving it into the pane makes it a tab.
    out="$(cmux diff - --workspace "$ws" --surface "$src" --no-focus --title "$title" --id-format uuids)" || return
    cmux move-surface --surface "$(sed -n 's/.*surface=\([^ ]*\).*/\1/p' <<<"$out")" --pane "$pane" --workspace "$ws" --focus false >/dev/null
    return
  fi
  # No diff workspace, or it was closed. A new workspace starts with a
  # terminal; the diff splits off it, and closing the terminal leaves the diff.
  ws="$(CMUX_QUIET=1 cmux workspace create --name "Commit diffs" --focus false | awk '/^OK/ {print $2}')"
  ws="$(cmux workspace list --id-format both | awk -v r="$ws" '{sub(/^\*/, "")} $1 == r {print $2}')"
  src="$(cmux list-pane-surfaces --workspace "$ws" --json | jq -r '.surfaces[0].id // empty')"
  [[ -n "$ws" && -n "$src" ]] || return
  out="$(cmux diff - --workspace "$ws" --surface "$src" --no-focus --title "$title" --id-format uuids)" || return
  cmux close-surface --surface "$src" --workspace "$ws" >/dev/null
  echo "$ws $(sed -n 's/.*pane=\([^ ]*\).*/\1/p' <<<"$out")" >"$STATE"
}

# Each repo a `git ... commit` in the command ran in, following cd and git -C.
repos=$(python3 -c '
import json
import os
import shlex
import sys

try:
    data = json.load(sys.stdin)
    lex = shlex.shlex((data.get("tool_input") or {}).get("command") or "", posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    tokens = list(lex)
except Exception:
    sys.exit(0)

cwd = data.get("cwd") or os.getcwd()
segments, cur = [], []
for t in tokens:
    if t and all(c in "();<>|&" for c in t):
        segments.append(cur)
        cur = []
    else:
        cur.append(t)
segments.append(cur)

repos = []
for words in segments:
    while words and "=" in words[0] and not words[0].startswith("-"):
        words = words[1:]
    if not words:
        continue
    if words[0] == "cd" and len(words) > 1:
        cwd = os.path.join(cwd, os.path.expanduser(words[1]))
    if os.path.basename(words[0]) != "git":
        continue
    repo, i = cwd, 1
    while i < len(words) and words[i].startswith("-"):
        if words[i] == "-C" and i + 1 < len(words):
            repo = os.path.join(repo, os.path.expanduser(words[i + 1]))
        if words[i] in ("-C", "-c"):
            i += 1
        i += 1
    if i < len(words) and words[i] == "commit" and repo not in repos:
        repos.append(repo)
print("\n".join(repos))
') || exit 0

# Parallel lanes can commit at once; the lock keeps them to one workspace.
LOCK="$STATE.lock"
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

while IFS= read -r repo; do
  [[ -n "$repo" ]] || continue
  sha="$(git -C "$repo" rev-parse --verify -q HEAD 2>/dev/null)" || continue
  gitdir="$(git -C "$repo" rev-parse --absolute-git-dir 2>/dev/null)" || continue
  [[ "$(cat "$gitdir/marrow-diff-shown" 2>/dev/null)" != "$sha" ]] || continue
  # A commit made just now, not one left from earlier by a failed commit.
  (( $(date +%s) - $(git -C "$repo" log -1 --format=%ct "$sha") < 300 )) || continue
  echo "$sha" >"$gitdir/marrow-diff-shown"

  patch="$(git -C "$repo" show --format= --diff-merges=first-parent "$sha")"
  [[ -n "$patch" ]] || continue
  mkdir -p "$(dirname "$STATE")"
  # A lock still held after 10 seconds was left by a killed hook; take it over.
  for _ in $(seq 50); do mkdir "$LOCK" 2>/dev/null && break; sleep 0.2; done
  printf '%s\n' "$patch" | show_diff "$(git -C "$repo" log -1 --format='%h %s' "$sha")" 2>/dev/null
  rmdir "$LOCK" 2>/dev/null
done <<<"$repos"
exit 0
