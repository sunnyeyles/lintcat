#!/usr/bin/env bash
#
# PreToolUse hook — refuse Edit/Write under tooling/debt/baseline/.
# Only `pnpm debt baseline` writes there. DEBT_GUARD_SKIP=1 disables it.

set -uo pipefail

[ "${DEBT_GUARD_SKIP:-0}" = "1" ] && exit 0

payload=$(cat)
[ -n "$payload" ] || exit 0

extract_path() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null && return
  fi
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$payload" |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path||"")}catch{}})' 2>/dev/null
  fi
}

file=$(extract_path)
[ -n "$file" ] || exit 0

case "$file" in
*/tooling/debt/baseline/* | tooling/debt/baseline/*) ;;
*) exit 0 ;;
esac

{
  printf 'Refusing to edit %s.\n' "$file"
  printf 'The debt baseline is generated: run `pnpm debt baseline` (see tooling/debt/AGENTS.md).\n'
} >&2
exit 2
