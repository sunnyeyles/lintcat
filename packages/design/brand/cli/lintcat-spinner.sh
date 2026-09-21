#!/usr/bin/env bash
# LintCat terminal loader - POSIX-ish shell, one line, UTF-8 terminal required.
#   ./lintcat-spinner.sh "reviewing 412 lines" -- your-command --args
# Runs your command in the background and animates until it exits.
set -uo pipefail

STATUS="${1:-working}"; shift || true
[ "${1:-}" = "--" ] && shift

TEAL=$'\033[38;2;58;166;147m'
DIM=$'\033[2m'
RESET=$'\033[0m'
FRAMES=( "=(◔ ◔)=" "-(◔ ◔)-" "~(◔ ◔)~" "=(◕ ◕)=" "-(◕ ◕)-" "~(◕ ◕)~" "=(‿ ‿)=" "=(◔ ◔)=" )

if [ $# -gt 0 ]; then
  "$@" &
  PID=$!
else
  sleep 10 &
  PID=$!
fi

if [ -t 1 ]; then
  printf '\033[?25l'
  i=0
  while kill -0 "$PID" 2>/dev/null; do
    printf '\r%s%s%s  %s%s%s\033[K' "$TEAL" "${FRAMES[$((i % 8))]}" "$RESET" "$DIM" "$STATUS" "$RESET"
    i=$((i + 1))
    sleep 0.26
  done
  printf '\r\033[K\033[?25h'
else
  echo "lintcat: $STATUS"
fi

wait "$PID"
exit $?
