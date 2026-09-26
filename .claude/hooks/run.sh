#!/usr/bin/env bash
# Runs hook <name> from this checkout, else from the main repository root; exits 0 if neither has it.

here=${BASH_SOURCE[0]%/*}
script="$here/$1.sh"
if [ ! -f "$script" ]; then
  # shellcheck source=lib/worktree.sh
  . "$here/lib/worktree.sh" 2>/dev/null || exit 0
  root=$(resolve_repo_root </dev/null) || exit 0
  script="$root/.claude/hooks/$1.sh"
  [ -f "$script" ] || exit 0
fi
shift
exec bash "$script" "$@"
