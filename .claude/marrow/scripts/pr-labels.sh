#!/usr/bin/env bash
# Put a branch's deploy-risk labels (risk-labels.sh) on its open PR. Run by
# /marrow publish, after the PR is opened.
#
# Usage:
#   pr-labels.sh <repo> <pr-url> <base> <head>
#
# <base> and <head> are refs in <repo>, such as origin/main and
# origin/marrow/<feature>. A label missing from the GitHub repo is created
# with risk-labels.sh's colour and description; an existing one is left as it
# is. Labels are only ever added, never removed. Prints {"ok": true,
# "labels": [...], "created": [...]}. Exit 0 done, 1 failed, 2 on misuse.
set -uo pipefail

REPO="${1:-}" URL="${2:-}" BASE="${3:-}" HEAD="${4:-}"
if [[ -z "$REPO" || -z "$HEAD" || ! "$URL" =~ ^https://github\.com/([^/]+/[^/]+)/pull/[0-9]+$ ]]; then
  echo "usage: pr-labels.sh <repo> <https://github.com/owner/repo/pull/N> <base> <head>" >&2
  exit 2
fi
GH_REPO="${BASH_REMATCH[1]}"
HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

die() { jq -n --arg e "$1" '{ok: false, error: $e}'; exit 1; }

risk="$("$HERE/risk-labels.sh" "$REPO" "$BASE" "$HEAD")" || die "risk-labels.sh failed: $(jq -r '.error // .' <<<"$risk" 2>/dev/null)"
names="$(jq -r '.labels[].name' <<<"$risk")"
if [[ -z "$names" ]]; then
  jq -n '{ok: true, labels: [], created: []}'
  exit 0
fi

existing="$(gh label list -R "$GH_REPO" --limit 1000 --json name -q '.[].name')" || die "gh label list failed"
created=()
while IFS= read -r n; do
  grep -qxF "$n" <<<"$existing" && continue
  color="$(jq -r --arg n "$n" '.labels[] | select(.name == $n) | .color' <<<"$risk")"
  desc="$(jq -r --arg n "$n" '.labels[] | select(.name == $n) | .description' <<<"$risk")"
  gh label create "$n" -R "$GH_REPO" --color "$color" --description "$desc" >/dev/null || die "gh label create $n failed"
  created+=("$n")
done <<<"$names"

gh pr edit "$URL" --add-label "$(paste -sd, - <<<"$names")" >/dev/null || die "gh pr edit --add-label failed"
jq -n --arg l "$names" --arg c "$(printf '%s\n' ${created[@]+"${created[@]}"})" \
  '{ok: true, labels: ($l | split("\n") | map(select(length > 0))), created: ($c | split("\n") | map(select(length > 0)))}'
