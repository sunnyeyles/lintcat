#!/usr/bin/env bash
#
# Tests for debt-baseline-guard.sh.
#
#   bash .claude/hooks/debt-baseline-guard.test.sh

set -uo pipefail

hook_dir=$(cd "${BASH_SOURCE[0]%/*}" && pwd)
hook="$hook_dir/debt-baseline-guard.sh"

pass=0
fail=0
check() {
  local name="$1" expected="$2" input="$3"
  printf '%s' "$input" | bash "$hook" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$expected" ]; then
    printf '  ok    %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  FAIL  %s  (exit %s, wanted %s)\n' "$name" "$got" "$expected"
    fail=$((fail + 1))
  fi
}

check "blocks a baseline file" 2 '{"tool_input":{"file_path":"/repo/tooling/debt/baseline/apps-web.json"}}'
check "blocks a relative baseline path" 2 '{"tool_input":{"file_path":"tooling/debt/baseline/_meta.json"}}'
check "allows the config" 0 '{"tool_input":{"file_path":"/repo/tooling/debt/debt.config.json"}}'
check "allows product code" 0 '{"tool_input":{"file_path":"/repo/packages/db/src/schema.ts"}}'
check "allows an empty payload" 0 ''
DEBT_GUARD_SKIP=1 check "skips when disabled" 0 '{"tool_input":{"file_path":"tooling/debt/baseline/x.json"}}'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
