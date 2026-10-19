#!/usr/bin/env bash
# Write <repo>/.marrow/README.md, the overview of every marrow run in the
# repo, newest first, and print it.
#
# Usage:
#   runs.sh <path in the repo>
#
# One row per run folder (see run-dir.sh): what it is, how far it got, and
# its PR or cloud session. The stage is read from the files in the folder, so
# rerunning this is always enough to bring the overview up to date; the
# scripts that move a run on (run-dir.sh, approve.sh, cloud-launch.sh,
# cloud-status.sh) rerun it themselves. A build starts with cloud.json (in
# the cloud) or build-args.json (here), never both, and the stage is:
#
#   building       result.json isn't newer than the build's start, or is missing
#   published      published.json is no older than the build's start
#   built: <s>     result.json's status
#   then approve.sh status: plan approved, plan changed since approval, plan
#   drafted, spec approved, spec changed since approval, spec drafted, started
#
# With no .marrow/ it writes nothing. Exit 0, or 2 on misuse.
set -euo pipefail

[[ $# -eq 1 ]] || { echo "usage: runs.sh <path in the repo>" >&2; exit 2; }
REPO="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || { echo "usage: runs.sh <path in the repo>" >&2; exit 2; }
ROOT="$REPO/.marrow"

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

# stage <run dir> <build start file or "">: how far a feature run got.
stage() {
  local d="$1" start="$2" approval
  # bash 3.2 compares whole seconds; no build finishes in the second it started, so a tie is building.
  if [[ -n "$start" && ( ! -f "$d/result.json" || ! "$d/result.json" -nt "$start" ) ]]; then echo building
  # cloud-status.sh rewrites result.json on every call, so publishing is timed against the start.
  elif [[ -f "$d/published.json" && ( -z "$start" || ! "$start" -nt "$d/published.json" ) ]]; then echo published
  elif [[ -f "$d/result.json" ]]; then echo "built: $(jq -r '.status // "unknown"' "$d/result.json")"
  else
    approval="$("$HERE/approve.sh" "$d" status 2>/dev/null || true)"
    if [[ "$approval" == plan* || "$approval" == "spec changed" ]]; then echo "${approval/changed/changed since approval}"
    elif [[ -f "$d/plan.json" ]]; then echo "plan drafted"
    elif [[ "$approval" == "spec approved" ]]; then echo "spec approved"
    elif [[ -f "$d/spec.md" ]]; then echo "spec drafted"
    else echo started
    fi
  fi
}

ROWS=() # in folder order: oldest date first
for d in "$ROOT"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/; do
  [[ -d "$d" ]] || continue
  d="${d%/}" name="${d##*/}" link=""
  if [[ "${name:11}" == review-* ]]; then
    what=review
    if [[ -f "$d/report.md" ]]; then st=reviewed; else st=reviewing; fi
  else
    start=""
    for f in "$d/cloud.json" "$d/build-args.json"; do
      if [[ -s "$f" && ( -z "$start" || "$f" -nt "$start" ) ]]; then start="$f"; fi
    done
    st="$(stage "$d" "$start")"
    what="$(sed -nE '1s/^# *(Spec: *)?//p' "$d/spec.md" 2>/dev/null || true)"
    what="${what:-${name:11}}"
    [[ "$what" == *'|'* ]] && what="$(sed 's/|/\\|/g' <<<"$what")" # a raw pipe would split the cell
    if [[ "$st" == published ]]; then
      url="$(jq -r '.pr // empty' "$d/published.json" 2>/dev/null || true)"
      link="${url:+[PR]($url)}"
    elif [[ "$st" == building && "$start" == */cloud.json ]]; then
      url="$(jq -r '.session_url // empty' "$d/cloud.json" 2>/dev/null || true)"
      link="${url:+[session]($url)}"
    fi
  fi
  ROWS+=("| [$name]($name/) | $what | $st | $link |")
done

OUT="# Marrow runs

Every marrow run in this repo, newest first, one folder each. \`runs.sh\` rewrites this file, so edits to it are lost.
"
if [[ ${#ROWS[@]} -eq 0 ]]; then
  OUT+="
No runs yet. Start one with \`/marrow new <feature>\`."
else
  OUT+="
| Run | What | Stage | Link |
| --- | --- | --- | --- |"
  for ((i = ${#ROWS[@]} - 1; i >= 0; i--)); do OUT+=$'\n'"${ROWS[i]}"; done
fi

if [[ -d "$ROOT" ]]; then
  # A temp file of its own, since a background cloud-status.sh may refresh at the same time.
  tmp="$(mktemp "$ROOT/.README.XXXXXX")"
  echo "$OUT" >"$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$ROOT/README.md"
fi
echo "$OUT"
