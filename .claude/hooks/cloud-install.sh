#!/usr/bin/env bash
# Cloud sessions (claude.ai/code) start from a bare clone; local sessions exit at once.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -d node_modules ] && exit 0

# corepack runs the pnpm that package.json pins, whatever the image ships.
if out=$(COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile 2>&1); then
  printf '{"systemMessage":"Installed node_modules for this cloud session"}\n'
else
  tail=$(printf '%s' "$out" | tail -5 | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"systemMessage":"pnpm install failed; run it by hand before trusting any command. %s"}\n' "$tail"
fi
