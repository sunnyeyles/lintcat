#!/usr/bin/env bash
# Print the Workflow args for workflows/build.js, after checking that the
# spec and plan are approved and unchanged.
#
# Usage:
#   build-args.sh <repo> <feature> <marrow-dir> [--lite] [--no-push]
#
# --lite     one review fix round instead of two, no Standards reviewer.
# --no-push  stop after the final rebase and checks; the branch stays local
#            (local builds push only at /marrow publish).
# Exit 0 with the JSON on stdout, 1 with the reason on stderr, 2 on misuse.
set -euo pipefail

REPO_ARG="${1:-}" FEATURE="${2:-}" MARROW="${3:-}"
if [[ -z "$REPO_ARG" || ! "$FEATURE" =~ ^[A-Za-z0-9._-]+$ || ! -d "$MARROW/workflows" ]]; then
  echo "usage: build-args.sh <repo> <feature> <marrow-dir> [--lite] [--no-push]" >&2
  exit 2
fi
shift 3
LITE=false PUSH=true
for a in "$@"; do
  case "$a" in
    --lite) LITE=true ;;
    --no-push) PUSH=false ;;
    *) echo "unknown flag $a" >&2; exit 2 ;;
  esac
done

REPO="$(git -C "$REPO_ARG" rev-parse --show-toplevel)"
MARROW="$(cd -P "$MARROW" && pwd)"
FDIR="$("$MARROW/scripts/run-dir.sh" find "$REPO" "$FEATURE")"
"$MARROW/scripts/approve.sh" "$FDIR" check >/dev/null
WAVES="$("$MARROW/scripts/plan-check.sh" "$FDIR")" || { echo "$WAVES" >&2; exit 1; }

BASE="$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
BASE="${BASE:-main}"
URL="$(git -C "$REPO" config --get remote.origin.url || true)"
GH="$(sed -nE 's#.*github\.com[:/]([^/]+/[^/]+)$#\1#p' <<<"${URL%.git}")"

jq -n --arg feature "$FEATURE" --arg repo "$REPO" --arg base "$BASE" --arg gh "$GH" \
  --arg fdir "$FDIR" --arg marrow "$MARROW" --argjson lite "$LITE" --argjson push "$PUSH" \
  --argjson waves "$(jq '.waves' <<<"$WAVES")" --slurpfile plan "$FDIR/plan.json" \
  '{feature: $feature, lite: $lite, push: $push, lanes: ($plan[0].lanes // 3), marrowDir: $marrow, featureDir: $fdir,
    specPath: "\($fdir)/spec.md", planPath: "\($fdir)/plan.json",
    repo: {name: ($repo | split("/") | last), path: $repo, base_branch: $base,
           gh_repo: (if $gh == "" then null else $gh end),
           worktree: "\($repo)/.claude/worktrees/marrow-\($feature)", branch: "marrow/\($feature)"},
    criteria: $plan[0].criteria, tickets: $plan[0].tickets, waves: $waves}'
