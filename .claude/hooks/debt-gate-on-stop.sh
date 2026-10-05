#!/usr/bin/env bash
#
# Stop hook — on a debt/* or worktree-debt-* branch with changes, run the debt
# gate and surface a red result. DEBT_GATE_SKIP=1 disables it.

set -uo pipefail

[ "${DEBT_GATE_SKIP:-0}" = "1" ] && exit 0
command -v git >/dev/null 2>&1 || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

case "$branch" in
debt/* | worktree-debt-* | *debt-*) ;;
*) exit 0 ;;
esac

[ -d "$root/tooling/debt" ] || exit 0
[ -d "$root/node_modules" ] || exit 0

if git -C "$root" diff --quiet HEAD -- . ':!tooling/debt/.out' 2>/dev/null &&
  [ -z "$(git -C "$root" status --porcelain --untracked-files=all -- . ':!tooling/debt/.out' 2>/dev/null)" ]; then
  exit 0
fi

out=$(cd "$root" && pnpm --silent debt gate --skip network,dead-code 2>&1)
status=$?
[ "$status" = 0 ] && exit 0

{
  printf 'Debt gate is red on %s. Fix the regression before stopping; never --force or edit the baseline.\n\n' "$branch"
  printf '%s\n' "$out" | sed -n '/^## Regressions/,/^## /p' | head -40
  printf '\nFull report: tooling/debt/.out/gate/report.md\n'
} >&2
exit 2
