#!/usr/bin/env bash
# Run checks.sh in the background, so a suite longer than one Bash call
# (10 minutes) still reports.
#
# Usage:
#   run-checks.sh start <worktree>                # prints the run directory
#   run-checks.sh wait <run dir> [seconds]       # waits up to seconds (default 540)
#
# wait prints checks.sh's JSON and exits with its code once it has finished,
# or exits 75 while it is still running: call wait again. A run older than
# MARROW_CHECKS_MAX seconds (default 3600) is killed and reported as an error.
set -uo pipefail

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

usage() {
  echo "usage: run-checks.sh start <worktree> | wait <run dir> [seconds]" >&2
  exit 2
}

# fail <message>: checks.sh gave no usable result.
fail() {
  jq -n --arg e "$1" --arg d "$DIR" '{ok: false, error: $e, log_dir: $d}'
  tail -n 30 "$DIR/stderr.log" >&2 2>/dev/null
  exit 1
}

case "${1:-}" in
  start)
    [[ $# -eq 2 ]] || usage
    TMP_BASE="${TMPDIR:-/tmp}"
    DIR="$(mktemp -d "${TMP_BASE%/}/marrow-run.XXXXXX")"
    date +%s >"$DIR/started_at"
    # Job control gives the run its own process group, so a timeout kills its children too.
    set -m
    nohup "$HERE/run-checks.sh" _run "$2" "$DIR" >/dev/null 2>&1 </dev/null &
    echo $! >"$DIR/pid"
    echo "$DIR"
    ;;
  _run)
    MARROW_LOG_DIR="$3" "$HERE/checks.sh" "$2" >"$3/stdout.json" 2>"$3/stderr.log"
    echo $? >"$3/exit_code"
    ;;
  wait)
    [[ $# -ge 2 && -f "$2/pid" ]] || usage
    DIR="$2"
    pid="$(cat "$DIR/pid")"
    started="$(cat "$DIR/started_at")"
    max="${MARROW_CHECKS_MAX:-3600}"
    end=$((SECONDS + ${3:-540}))
    while [[ ! -s "$DIR/exit_code" ]]; do
      if ! kill -0 "$pid" 2>/dev/null; then
        sleep 1
        [[ -s "$DIR/exit_code" ]] && break
        fail "checks.sh died without an exit code"
      fi
      if (($(date +%s) - started > max)); then
        kill -TERM -- "-$pid" 2>/dev/null
        for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
        kill -KILL -- "-$pid" 2>/dev/null
        fail "checks ran past ${max}s and were killed"
      fi
      if ((SECONDS >= end)); then
        echo "still running: $DIR; run wait again" >&2
        exit 75
      fi
      sleep 5
    done
    rc="$(cat "$DIR/exit_code")"
    jq -e . "$DIR/stdout.json" >/dev/null 2>&1 || fail "checks.sh exited $rc without JSON on stdout"
    cat "$DIR/stdout.json"
    tail -n 30 "$DIR/stderr.log" >&2
    exit "$rc"
    ;;
  *) usage ;;
esac
