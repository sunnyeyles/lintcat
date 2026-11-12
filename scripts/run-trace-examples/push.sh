#!/usr/bin/env sh
# Pushes one trace file, format auto-detected: RUN_TRACE_URL=… RUN_TRACE_TOKEN=… ./push.sh <run-id> <file>
set -eu
run_id="$1"
file="$2"
jq -n --arg name "$(basename "$file")" --rawfile text "$file" '{files: [{name: $name, text: $text}]}' |
  curl --fail-with-body -sS -X POST "$RUN_TRACE_URL/api/run-trace/$run_id" \
    -H "authorization: Bearer $RUN_TRACE_TOKEN" \
    -H "content-type: application/json" \
    --data-binary @-
