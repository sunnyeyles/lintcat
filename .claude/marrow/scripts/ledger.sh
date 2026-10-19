#!/usr/bin/env bash
# Run every built ticket's acceptance tests in one worktree and report each
# acceptance criterion's status: the ledger that goes in the report and PR.
#
# Usage:
#   ledger.sh <worktree> <plan.json> <built tickets: id[:tests-commit],...>
#
# A criterion passes when every built ticket covering it passes its tests and,
# when its tests commit is given, its test files are byte-identical to that
# commit (nothing weakened them after the lane). Statuses: pass, fail,
# tampered, manual (verify: manual), not-built (a covering ticket wasn't
# built). Prints JSON; exit 0 when no auto criterion fails or is tampered.
set -uo pipefail

WT="${1:-}" PLAN="${2:-}" BUILT="${3:-}"
if [[ -z "$WT" || ! -f "$PLAN" ]]; then
  echo "usage: ledger.sh <worktree> <plan.json> <built ids>" >&2
  exit 2
fi
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/marrow-ledger.XXXXXX")"
RESULTS="$LOGS/results.jsonl"
: >"$RESULTS"

IDS_CSV=""
IFS=',' read -ra ITEMS <<<"$BUILT"
for item in ${ITEMS[@]+"${ITEMS[@]}"}; do
  id="${item%%:*}"
  tc=""
  [[ "$item" == *:* ]] && tc="${item#*:}"
  IDS_CSV="$IDS_CSV,$id"
  changed="[]"
  if [[ -n "$tc" ]]; then
    paths=()
    while IFS= read -r p; do [[ -n "$p" ]] && paths+=("$p"); done < <(jq -r --arg id "$id" '.tickets[] | select(.id == $id) | (.tests.paths // [])[]' "$PLAN")
    if [[ ${#paths[@]} -gt 0 ]]; then
      changed="$(git -C "$WT" diff --name-only "$tc" HEAD -- "${paths[@]}" 2>/dev/null | jq -R . | jq -s .)"
    fi
  fi
  cmd="$(jq -r --arg id "$id" '.tickets[] | select(.id == $id) | .tests.command // ""' "$PLAN")"
  rc=0
  if [[ -n "$cmd" ]]; then
    (cd "$WT" && CI=true bash -o pipefail -c "$cmd") >"$LOGS/$id.log" 2>&1
    rc=$?
  fi
  jq -nc --arg id "$id" --argjson rc "$rc" --arg log "$LOGS/$id.log" --argjson ch "$changed" \
    '{id: $id, exit: $rc, log: $log, tests_changed: $ch}' >>"$RESULTS"
done
BUILT="${IDS_CSV#,}"

jq -n --slurpfile plan "$PLAN" --slurpfile res "$RESULTS" --arg built "$BUILT" '
  ($res | map({key: .id, value: .}) | from_entries) as $r
  | ($built | split(",") | map(select(length > 0))) as $b
  | $plan[0] as $p
  | [ $p.criteria[] | . as $c
      | [ $p.tickets[] | select((.criteria // []) | index($c.id)) | .id ] as $by
      | { id: $c.id, text: $c.text, verify: ($c.verify // "auto"), tickets: $by,
          status: (if ($c.verify // "auto") == "manual" then "manual"
                   elif ($by | length) == 0 then "not-built"
                   elif ($by | map(. as $id | select(($b | index($id)) == null)) | length) > 0 then "not-built"
                   elif ($by | map(select((($r[.].tests_changed // []) | length) > 0)) | length) > 0 then "tampered"
                   elif ($by | map(select(($r[.].exit // 0) != 0)) | length) > 0 then "fail"
                   else "pass" end) } ] as $criteria
  | { ok: ($criteria | map(select(.status == "fail" or .status == "tampered")) | length == 0),
      criteria: $criteria, tickets: ($res), logs: "'"$LOGS"'" }'
jq -e '[.[] | select(.exit != 0 or (.tests_changed | length) > 0)] | length == 0' --slurp "$RESULTS" >/dev/null
