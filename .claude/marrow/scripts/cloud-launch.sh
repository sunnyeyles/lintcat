#!/usr/bin/env bash
# Start a marrow build in a Claude Code cloud session.
#
# Usage:
#   cloud-launch.sh <repo> <feature> [--lite] [--replace] [--dry-run]
#
# Cloud sessions see only the repo's own .claude/ and CLAUDE.md, so this
# pushes a run branch, marrow-run/<feature>, cut from origin/<default>, that
# carries marrow itself (.claude/marrow, .claude/agents/marrow-*.md, the
# codebase-design skill, a guard hook in .claude/settings.json) and the
# approved spec and plan (the feature's run folder in .marrow/). The cloud session builds on
# marrow/<feature> in a worktree, so none of that reaches the feature branch,
# pushes marrow/<feature> and its report back to the run branch, and opens no
# PR. /marrow publish does that locally, after you approve.
#
# --replace  overwrite an existing marrow-run/<feature> on origin.
# --dry-run  build and show the scaffold commit; push and launch nothing.
# Writes cloud.json into the run folder. Exit 0 launched, 1 failed.
set -euo pipefail

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
SRC="$(cd -P "$HERE/.." && pwd)"
REPO_ARG="${1:-}" FEATURE="${2:-}"
if [[ -z "$REPO_ARG" || ! "$FEATURE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: cloud-launch.sh <repo> <feature> [--lite] [--replace] [--dry-run]" >&2
  exit 2
fi
shift 2
LITE="" REPLACE=0 DRY=0
for a in "$@"; do
  case "$a" in
    --lite) LITE="--lite" ;;
    --replace) REPLACE=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "unknown flag $a" >&2; exit 2 ;;
  esac
done

REPO="$(git -C "$REPO_ARG" rev-parse --show-toplevel)"
FDIR="$("$HERE/run-dir.sh" find "$REPO" "$FEATURE")"
REL="${FDIR#"$REPO"/}"
RUN="marrow-run/$FEATURE"
"$HERE/approve.sh" "$FDIR" check >/dev/null

URL="$(git -C "$REPO" config --get remote.origin.url || true)"
[[ "$URL" == *github.com* ]] || { echo "cloud builds need a GitHub origin; use /marrow build --here" >&2; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not found" >&2; exit 1; }

git -C "$REPO" fetch origin --prune --quiet
BASE="$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
BASE="${BASE:-main}"
if git -C "$REPO" ls-remote --exit-code --heads origin "$RUN" >/dev/null 2>&1 && [[ $REPLACE -eq 0 ]]; then
  echo "origin already has $RUN (an earlier run). Use --replace to start over, or /marrow status $FEATURE." >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/marrow-run.XXXXXX")"
WT="$TMP/wt"
cleanup() {
  git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
  git -C "$REPO" branch -D "$RUN" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
git -C "$REPO" branch -D "$RUN" >/dev/null 2>&1 || true
git -C "$REPO" worktree add -q -b "$RUN" "$WT" "origin/$BASE"

# marrow itself, with hook paths pointing into the clone.
mkdir -p "$WT/.claude/marrow" "$WT/.claude/agents" "$WT/.claude/skills" "$WT/$REL"
cp -R "$SRC/scripts" "$SRC/workflows" "$SRC/references" "$SRC/CLOUD.md" "$SRC/lessons.md" "$WT/.claude/marrow/"
for a in "$SRC"/agents/*.md; do
  sed 's#\$HOME/\.claude/marrow#$CLAUDE_PROJECT_DIR/.claude/marrow#g' "$a" >"$WT/.claude/agents/$(basename "$a")"
done
[[ -e "$WT/.claude/skills/codebase-design" ]] || cp -R "$SRC/skills/codebase-design" "$WT/.claude/skills/"

# One repo-level guard as well, in case agent frontmatter hooks don't fire in the cloud.
HOOK='{"matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/marrow/scripts/guard.sh auto"}]}'
SETTINGS="$WT/.claude/settings.json"
[[ -f "$SETTINGS" ]] || echo '{}' >"$SETTINGS"
jq --argjson h "$HOOK" '.hooks.PreToolUse = ((.hooks.PreToolUse // []) + [$h])' "$SETTINGS" >"$SETTINGS.tmp"
mv "$SETTINGS.tmp" "$SETTINGS"

cp "$FDIR/spec.md" "$FDIR/plan.json" "$FDIR/approvals.json" "$WT/$REL/"
# The repo's setup from /marrow setup, when it lives only in the local checkout.
for f in checks notes.md; do
  if [[ -f "$REPO/.marrow/$f" && ! -f "$WT/.marrow/$f" ]]; then cp "$REPO/.marrow/$f" "$WT/.marrow/$f"; fi
done
# Commits in the cloud carry your identity, not the VM's.
jq -n --arg n "$(git -C "$REPO" config user.name || true)" --arg e "$(git -C "$REPO" config user.email || true)" \
  '{name: $n, email: $e}' >"$WT/$REL/identity.json"
git -C "$WT" add -f .claude .marrow
git -C "$WT" commit -q -m "marrow: run scaffold for $FEATURE" -m "Throwaway branch for a marrow cloud build. Deleted by /marrow publish."

if [[ $DRY -eq 1 ]]; then
  git -C "$WT" show --stat --format='%s' HEAD
  echo "dry run: nothing pushed or launched"
  exit 0
fi

if [[ $REPLACE -eq 1 ]]; then
  git -C "$WT" push -q --force origin "$RUN"
else
  git -C "$WT" push -q -u origin "$RUN"
fi
# This is now a cloud build; a build here would have left build-args.json (see runs.sh).
rm -f "$FDIR/build-args.json"

PROMPT="Marrow cloud build of feature \"$FEATURE\"${LITE:+ (lite)}. Follow .claude/marrow/CLOUD.md exactly, with FEATURE=$FEATURE${LITE:+ and LITE=1}. Don't ask questions: run to the end, then push the report as it says."

# claude --cloud clones origin at the current branch, so run it from the run worktree.
LOG="$FDIR/cloud.log"
set +e
(cd "$WT" && perl -e 'alarm shift; exec @ARGV' 180 claude --cloud "$PROMPT" </dev/null) >"$LOG" 2>&1
rc=$?
set -e
SESSION="$(grep -Eo 'https://claude\.ai/code/[A-Za-z0-9_/-]+' "$LOG" | head -n 1 || true)"

jq -n --arg run "$RUN" --arg branch "marrow/$FEATURE" --arg base "$BASE" --arg url "$SESSION" \
  --arg at "$(date -u +%FT%TZ)" --argjson rc "$rc" --arg prompt "$PROMPT" \
  '{run_branch: $run, feature_branch: $branch, base: $base, session_url: (if $url == "" then null else $url end),
    launched_at: $at, launch_exit: $rc, prompt: $prompt}' >"$FDIR/cloud.json"
cat "$FDIR/cloud.json"
"$HERE/runs.sh" "$REPO" >/dev/null 2>&1 || true
if [[ $rc -ne 0 && -z "$SESSION" ]]; then
  echo "claude --cloud exited $rc with no session URL; see $LOG. The run branch is pushed, so you can start it by hand:" >&2
  echo "  cd into a checkout of $RUN and run: claude --cloud '$PROMPT'" >&2
  exit 1
fi
