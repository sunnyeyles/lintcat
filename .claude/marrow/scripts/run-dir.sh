#!/usr/bin/env bash
# Find or start a run's folder. Every run is one folder in <repo>/.marrow/,
# named by the date it started, so a listing of .marrow/ reads as the repo's
# history of runs:
#
#   <YYYY-MM-DD>-<feature>          a feature
#   <YYYY-MM-DD>-review-<slug>      a review of a branch (-2, -3 ... for another that day)
#
# Usage:
#   run-dir.sh find <repo> <feature>     # the feature's run folder
#   run-dir.sh new <repo> <feature>      # start one, dated today
#   run-dir.sh review <repo> <branch>    # start a review run of <branch>
#
# Feature names are [A-Za-z0-9._-]+ and can't start with "review-". Prints
# the folder's absolute path. Starting a run makes .marrow/ if needed, with a
# .gitignore of "*" so none of it reaches git; /marrow setup can rewrite that
# file to share the setup. new and review refresh the overview (runs.sh);
# find never writes, which is all a cloud session uses. Exit 0 ok, 1 when find
# finds no run or new finds the feature already has one, 2 on misuse.
set -euo pipefail

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

usage() { echo "usage: run-dir.sh find|new <repo> <feature> | review <repo> <branch>" >&2; exit 2; }

[[ $# -eq 3 ]] || usage
CMD="$1" NAME="$3"
case "$CMD" in
  find | new) [[ "$NAME" =~ ^[A-Za-z0-9._-]+$ && "$NAME" != review-* ]] || usage ;;
  review) [[ -n "$NAME" ]] || usage ;;
  *) usage ;;
esac
REPO="$(git -C "$2" rev-parse --show-toplevel 2>/dev/null)" || usage
ROOT="$REPO/.marrow"
DATED='[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'

# feature_run <feature>: the feature's run folder, whatever day it started.
feature_run() {
  local d
  for d in "$ROOT"/$DATED-"$1"; do
    [[ -d "$d" ]] && { echo "$d"; return 0; }
  done
  return 1
}

start() {
  mkdir -p "$ROOT"
  [[ -e "$ROOT/.gitignore" ]] || echo '*' >"$ROOT/.gitignore"
}

case "$CMD" in
  find)
    feature_run "$NAME" || { echo "no run for feature $NAME in $ROOT; start one with /marrow new $NAME" >&2; exit 1; }
    ;;
  new)
    if existing="$(feature_run "$NAME")"; then
      echo "feature $NAME already has a run: $existing" >&2
      exit 1
    fi
    start
    dir="$ROOT/$(date +%F)-$NAME"
    mkdir "$dir"
    echo "$dir"
    "$HERE/runs.sh" "$REPO" >/dev/null 2>&1 || true
    ;;
  review)
    start
    dir="$ROOT/$(date +%F)-review-$(printf '%s' "$NAME" | tr -c 'A-Za-z0-9._-' '-')" n=2
    base="$dir"
    while [[ -e "$dir" ]]; do
      dir="$base-$n"
      n=$((n + 1))
    done
    mkdir "$dir"
    echo "$dir"
    "$HERE/runs.sh" "$REPO" >/dev/null 2>&1 || true
    ;;
esac
