#!/usr/bin/env bash
# Try the LintCat terminal loaders: `pnpm spinner` runs each for a few seconds.
#   pnpm spinner            # all three, in turn
#   pnpm spinner line       # just the one-line face (node)
#   pnpm spinner block      # just the five-row block art (node)
#   pnpm spinner sh         # the bash wrapper around a real command
#   pnpm spinner py         # the Python context manager (needs python3)
set -uo pipefail
cd "$(dirname "$0")/.."
CLI=packages/design/brand/cli
SECONDS_EACH=${SPINNER_SECONDS:-4}

demo_node() {
  node "$CLI/lintcat-spinner.js" "$1" "$2" &
  local pid=$!
  sleep "$SECONDS_EACH"
  kill -INT "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

case "${1:-all}" in
  line)  demo_node line "reviewing 412 lines" ;;
  block) demo_node block "auditing dependency graph" ;;
  sh)    bash "$CLI/lintcat-spinner.sh" "mapping ./services" -- sleep "$SECONDS_EACH" ;;
  py)    python3 -c "import sys, time; sys.path.insert(0, '$CLI'); from lintcat_spinner import LintCat
with LintCat('synthesising findings', mode='line'): time.sleep($SECONDS_EACH)" ;;
  all)
    echo "node, line mode:";  demo_node line "reviewing 412 lines"
    echo "node, block mode:"; demo_node block "auditing dependency graph"
    echo "bash wrapper around a command:"; bash "$CLI/lintcat-spinner.sh" "mapping ./services" -- sleep "$SECONDS_EACH"
    if command -v python3 >/dev/null; then
      echo "python context manager:"; "$0" py
    fi
    ;;
  *) echo "usage: pnpm spinner [line|block|sh|py|all]" >&2; exit 2 ;;
esac
