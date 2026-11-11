#!/usr/bin/env bash
# A real host (claude or amp) spawns `factory mcp` and calls factory_start + factory_status. One short model prompt.
# Usage: apps/factory/scripts/mcp-host-smoke.sh claude|amp [scratch-dir]
set -euo pipefail

host="${1:?usage: mcp-host-smoke.sh claude|amp [scratch-dir]}"
here="$(cd "$(dirname "$0")" && pwd)"
start="$here/../start.mjs"
scratch="${2:-$(mktemp -d)}"
repo="$scratch/repo"

rm -rf "$repo"
mkdir -p "$repo"
git -C "$repo" init -q -b main
git -C "$repo" -c user.name=smoke -c user.email=smoke@example.invalid commit -q --allow-empty -m init

server_json=$(node -e 'console.log(JSON.stringify({ command: process.execPath, args: [process.argv[1], "mcp"] }))' "$start")
spec='{"title":"Add a --version flag","objective":"Print the package version","category":"quick","requirements":["--version prints the version"],"nonGoals":[],"constraints":[],"acceptanceCriteria":[{"id":"AC1","text":"Given the CLI, when run with --version, then it prints the version","verification":"automated"}],"plan":["Edit cli.js"],"architectureDecisions":[],"repositoryFindings":[],"assumptions":[],"estimatedFiles":1,"risk":"low","touchesSecurityOrData":false}'
prompt="Call the factory_start tool with repoPath \"$repo\" and this spec: $spec. Then call factory_status with the runId it returned. Do not call any other tool. Reply with exactly: RUN <runId> <status>"

case "$host" in
  claude)
    config="$scratch/mcp.json"
    printf '{"mcpServers":{"factory":%s}}\n' "$server_json" >"$config"
    (cd "$repo" && claude -p --strict-mcp-config --mcp-config "$config" \
      --allowedTools mcp__factory__factory_start mcp__factory__factory_status \
      --max-turns 6 "$prompt")
    ;;
  amp)
    # UNVERIFIED: written from ampcode.com/docs/cli/execute-mode and /docs/customize/mcp; Amp was not installed to run it.
    (cd "$repo" && amp --dangerously-allow-all --mcp-config "{\"factory\":$server_json}" -x "$prompt")
    ;;
  *)
    echo "unknown host $host" >&2
    exit 2
    ;;
esac

echo "--- factory status (independent check) ---"
(cd "$repo" && node "$start" status) >"$scratch/status.txt"
head -3 "$scratch/status.txt"
