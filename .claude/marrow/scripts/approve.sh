#!/usr/bin/env bash
# Record, or check, the human approval of a feature's spec and plan.
#
# Usage:
#   approve.sh <feature-dir> spec    # after the user approves spec.md
#   approve.sh <feature-dir> plan    # after the user approves plan.json
#   approve.sh <feature-dir> check   # both approved and unchanged since
#   approve.sh <feature-dir> status  # how far approval got, read-only
#
# Approvals go in <feature-dir>/approvals.json as sha256 hashes, so an edit
# after approval is caught. spec needs at least one ACn criterion and an
# empty "Open questions" section; plan needs plan-check.sh to pass against
# the approved spec. status prints one of: none, spec approved, spec changed,
# plan approved, plan changed. spec and plan also refresh the overview
# (runs.sh) when the folder is a run in .marrow/. Exit 0 ok, 1 not approved
# or changed, 2 on misuse.
set -euo pipefail

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
FDIR="${1:-}"
WHAT="${2:-}"
if [[ -z "$FDIR" || ! -d "$FDIR" || ! "$WHAT" =~ ^(spec|plan|check|status)$ ]]; then
  echo "usage: approve.sh <feature-dir> spec|plan|check|status" >&2
  exit 2
fi
FDIR="$(cd -P "$FDIR" && pwd)"
APPROVALS="$FDIR/approvals.json"

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}
fail() { echo "approve.sh: $1" >&2; exit 1; }
# approved spec|plan: the approved sha, or nothing.
approved() { if [[ -f "$APPROVALS" ]]; then jq -r --arg k "$1" '.[$k].sha // ""' "$APPROVALS"; fi; }
# matches <file> <sha>: the file exists and still has that sha.
matches() { [[ -n "$2" && -f "$1" && "$(sha "$1")" == "$2" ]]; }
# A run in .marrow/ has an overview to bring up to date; runs.sh never calls back into spec or plan.
refresh() { if [[ "$(basename "$(dirname "$FDIR")")" == .marrow ]]; then "$HERE/runs.sh" "$FDIR" >/dev/null 2>&1 || true; fi; }

check_spec() {
  local spec="$FDIR/spec.md"
  [[ -f "$spec" ]] || fail "no spec.md in $FDIR"
  grep -qE '\bAC[0-9]+\b' "$spec" || fail "spec.md has no acceptance criteria (AC1, AC2, ...)"
  # The open-questions section must be empty or say None.
  local open
  open="$(awk '/^## +Open questions/{f=1; next} /^## /{f=0} f' "$spec" | grep -vE '^\s*$|^\s*[-*]?\s*None\.?\s*$' || true)"
  [[ -z "$open" ]] || fail "spec.md still has open questions:"$'\n'"$open"
}

case "$WHAT" in
  spec)
    check_spec
    [[ -f "$APPROVALS" ]] || echo '{}' >"$APPROVALS"
    jq --arg s "$(sha "$FDIR/spec.md")" --arg at "$(date -u +%FT%TZ)" '.spec = {sha: $s, at: $at} | del(.plan)' \
      "$APPROVALS" >"$APPROVALS.tmp" && mv "$APPROVALS.tmp" "$APPROVALS"
    echo "spec approved: $(sha "$FDIR/spec.md" | cut -c1-12)"
    refresh
    ;;
  plan)
    matches "$FDIR/spec.md" "$(approved spec)" || fail "approve the current spec first"
    "$HERE/plan-check.sh" "$FDIR" >/dev/null || fail "plan-check.sh fails; run it to see why"
    jq --arg s "$(sha "$FDIR/plan.json")" --arg at "$(date -u +%FT%TZ)" '.plan = {sha: $s, at: $at}' \
      "$APPROVALS" >"$APPROVALS.tmp" && mv "$APPROVALS.tmp" "$APPROVALS"
    echo "plan approved: $(sha "$FDIR/plan.json" | cut -c1-12)"
    refresh
    ;;
  check)
    [[ -f "$FDIR/spec.md" && -f "$FDIR/plan.json" ]] || fail "spec.md and plan.json are both needed"
    matches "$FDIR/spec.md" "$(approved spec)" || fail "spec.md is not approved, or changed since"
    matches "$FDIR/plan.json" "$(approved plan)" || fail "plan.json is not approved, or changed since"
    echo "spec and plan approved"
    ;;
  status)
    s="$(approved spec)" p="$(approved plan)"
    if [[ -z "$s" ]]; then echo none
    elif ! matches "$FDIR/spec.md" "$s"; then echo "spec changed"
    elif [[ -z "$p" ]]; then echo "spec approved"
    elif ! matches "$FDIR/plan.json" "$p"; then echo "plan changed"
    else echo "plan approved"
    fi
    ;;
esac
