#!/usr/bin/env bash
# Report on a marrow cloud build: has the session pushed its report yet?
#
# Usage:
#   cloud-status.sh <repo> <feature>                 # one check
#   cloud-status.sh <repo> <feature> --wait [hours]  # poll until done (default 8h)
#
# When the report is on origin/marrow-run/<feature>, copies the run's output
# (report.md, agent-log.md, pr.md, ledger.json, result.json, feature.bundle) into
# the feature's run folder, refreshes the overview (runs.sh) and prints
# result.json. Exit 0 done, 3 still
# running, 1 timed out or failed.
set -uo pipefail

REPO_ARG="${1:-}" FEATURE="${2:-}"
if [[ -z "$REPO_ARG" || -z "$FEATURE" ]]; then
  echo "usage: cloud-status.sh <repo> <feature> [--wait [hours]]" >&2
  exit 2
fi
HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
REPO="$(git -C "$REPO_ARG" rev-parse --show-toplevel)" || exit 2
FDIR="$("$HERE/run-dir.sh" find "$REPO" "$FEATURE")" || exit 1
REL="${FDIR#"$REPO"/}"
RUN="marrow-run/$FEATURE"
WAIT=0 HOURS=8
if [[ "${3:-}" == "--wait" ]]; then WAIT=1; HOURS="${4:-8}"; fi
DEADLINE=$((SECONDS + HOURS * 3600))

check() {
  git -C "$REPO" fetch -q origin "+refs/heads/$RUN:refs/remotes/origin/$RUN" 2>/dev/null || return 3
  git -C "$REPO" cat-file -e "origin/$RUN:$REL/result.json" 2>/dev/null || return 3
  for f in report.md agent-log.md pr.md ledger.json result.json feature.bundle; do
    git -C "$REPO" show "origin/$RUN:$REL/$f" >"$FDIR/$f" 2>/dev/null || rm -f "$FDIR/$f"
  done
  cat "$FDIR/result.json"
  return 0
}

while :; do
  check
  rc=$?
  if [[ $rc -eq 0 ]]; then
    "$HERE/runs.sh" "$REPO" >/dev/null 2>&1 || true
    exit 0
  fi
  if [[ $WAIT -eq 0 ]]; then
    url="$(jq -r '.session_url // empty' "$FDIR/cloud.json" 2>/dev/null)"
    echo "still running${url:+: $url}"
    exit 3
  fi
  if ((SECONDS >= DEADLINE)); then
    echo "no report after ${HOURS}h" >&2
    exit 1
  fi
  sleep 120
done
