#!/usr/bin/env bash
# Run a repo's checks in a worktree and report them as JSON on stdout.
# Progress goes to stderr; full logs go to the log dir named in the JSON.
#
# Usage:
#   checks.sh [--setup-only] <worktree>
#
# --setup-only runs just the setup ("!") steps, such as installs.
#
# The checks come from .marrow/checks, read from the worktree (if committed)
# or else the repo's main checkout; MARROW_CHECKS_FILE, an absolute path,
# overrides both (/marrow setup uses it to prove a draft). One check per line, "name: command", run
# by bash in the worktree; a line starting with "#" is a comment. A name starting with "!" is
# a setup step: when it fails, the later steps are skipped. Example:
#
#   !install: pnpm install --frozen-lockfile
#   lint: pnpm lint
#   test: pnpm test
#
# With no .marrow/checks, the checks are detected from the worktree's files
# (package.json scripts, go.mod, Cargo.toml, uv.lock, a Makefile test target).
# A detected install is skipped when its lockfile and command match its last
# green run in this worktree and what it installs is still there; "!" steps
# from .marrow/checks always run.
#
# Exit 0 when every check is green, 1 when any is red, 2 on misuse. Each red
# step's tail goes to <log dir>/failures.md, not the JSON. run-checks.sh runs
# this in the background so a long suite outlives one Bash call.
set -uo pipefail

SETUP_ONLY=0
if [[ "${1:-}" == "--setup-only" ]]; then
  SETUP_ONLY=1
  shift
fi
WT="${1:-}"
if [[ -z "$WT" || ! -e "$WT/.git" ]]; then
  echo "usage: checks.sh [--setup-only] <worktree>" >&2
  exit 2
fi
WT="$(cd -P "$WT" && pwd)"

for c in jq git; do
  command -v "$c" >/dev/null 2>&1 || { echo "missing required command: $c" >&2; exit 2; }
done

TMP_BASE="${TMPDIR:-/tmp}"
LOG_DIR="${MARROW_LOG_DIR:-$(mktemp -d "${TMP_BASE%/}/marrow-checks.XXXXXX")}"
mkdir -p "$LOG_DIR"
: >"$LOG_DIR/steps.jsonl"
: >"$LOG_DIR/notes.txt"

export HUSKY=0 CI=true

STEP_N=0
FAILED=0
STOPPED=0

note() {
  echo "$1" >>"$LOG_DIR/notes.txt"
  echo "checks: note: $1" >&2
}

tail_of() {
  grep -vE '^\s*$' "$1" | tail -n 60
}

record() {
  local name="$1" cmd="$2" rc="$3" secs="$4" log="$5"
  jq -nc --arg name "$name" --arg cmd "$cmd" --argjson rc "$rc" --argjson secs "$secs" \
    --arg log "$log" --arg tail "$(tail_of "$log")" \
    '{name: $name, cmd: $cmd, exit_code: $rc, ok: ($rc == 0), seconds: $secs, log: $log, tail: $tail}' \
    >>"$LOG_DIR/steps.jsonl"
  if [[ "$rc" -ne 0 ]]; then
    FAILED=1
    echo "checks: RED   $name (exit $rc)" >&2
  else
    echo "checks: green $name" >&2
  fi
}

new_log() {
  STEP_N=$((STEP_N + 1))
  LOG_PATH="$(printf '%s/%02d-%s.log' "$LOG_DIR" "$STEP_N" "$(echo "$1" | tr -cs 'A-Za-z0-9' '-' | sed 's/-$//')")"
}

sha256() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }

# run_step <name> <command> [setup]: a failed setup step skips the rest.
# setup is "setup", or "install=<lockfile>=<output dir>" for a detected install.
run_step() {
  [[ $STOPPED -eq 1 ]] && return 1
  local name="$1" cmd="$2" setup="${3:-}" log start rc lock="" out="" stamp="" key=""
  new_log "$name"
  log="$LOG_PATH"
  if [[ "$setup" == install=* ]]; then
    IFS='=' read -r _ lock out <<<"$setup"
    if [[ -f "$WT/$lock" ]]; then
      stamp="$(git -C "$WT" rev-parse --absolute-git-dir)/marrow-install-$(echo "$name" | tr -cs 'A-Za-z0-9' '-' | sed 's/-$//').sha"
      key="$({ cat "$WT/$lock"; echo "$cmd"; } | sha256 | cut -d' ' -f1)"
      if [[ -f "$stamp" && "$(cat "$stamp")" == "$key" && ( -z "$out" || -e "$WT/$out" ) ]]; then
        echo "skipped: $lock unchanged since the last install in this worktree" >"$log"
        echo "checks: skip  $name ($lock unchanged)" >&2
        record "$name" "$cmd" 0 0 "$log"
        return 0
      fi
    fi
  fi
  echo "checks: run   $name" >&2
  start=$SECONDS
  (cd "$WT" && bash -o pipefail -c "$cmd") >"$log" 2>&1
  rc=$?
  record "$name" "$cmd" "$rc" "$((SECONDS - start))" "$log"
  if [[ -n "$stamp" ]]; then
    if [[ $rc -eq 0 ]]; then echo "$key" >"$stamp"; else rm -f "$stamp"; fi
  fi
  if [[ $rc -ne 0 && -n "$setup" ]]; then
    STOPPED=1
    note "stopped after: $name"
  fi
  return $rc
}

# ---- the check list: .marrow/checks, else detected ----

MAIN="$(dirname "$(cd "$WT" && cd -P "$(git rev-parse --git-common-dir)" && pwd)")"
CONFIG=""
if [[ -n "${MARROW_CHECKS_FILE:-}" ]]; then
  if [[ "$MARROW_CHECKS_FILE" != /* || ! -f "$MARROW_CHECKS_FILE" ]]; then
    jq -n --arg f "$MARROW_CHECKS_FILE" '{ok: false, error: "MARROW_CHECKS_FILE must be an absolute path to a file: \($f)"}'
    exit 2
  fi
  CONFIG="$MARROW_CHECKS_FILE"
else
  for f in "$WT/.marrow/checks" "$MAIN/.marrow/checks"; do
    if [[ -f "$f" ]]; then CONFIG="$f"; break; fi
  done
fi

STEPS=() # "setup|name|command"; setup is "", "setup", or "install=<lockfile>=<output dir>"
add() { STEPS+=("$1|$2|$3"); }

if [[ -n "$CONFIG" ]]; then
  note "checks from $CONFIG"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ "$line" != *:* ]]; then
      jq -n --arg l "$line" --arg f "$CONFIG" '{ok: false, error: "bad line in \($f), want \"name: command\": \($l)"}'
      exit 2
    fi
    name="$(echo "${line%%:*}" | xargs)"
    cmd="$(echo "${line#*:}" | sed 's/^[[:space:]]*//')"
    if [[ "$name" == !* ]]; then add setup "${name#!}" "$cmd"; else add "" "$name" "$cmd"; fi
  done <"$CONFIG"
else
  note "no .marrow/checks; detected checks from the worktree"
  if [[ -f "$WT/package.json" ]]; then
    if [[ -f "$WT/pnpm-lock.yaml" ]]; then pm=pnpm; add install=pnpm-lock.yaml=node_modules "pnpm install" "pnpm install --frozen-lockfile --prefer-offline"
    elif [[ -f "$WT/yarn.lock" ]]; then pm=yarn; add install=yarn.lock=node_modules "yarn install" "yarn install --frozen-lockfile"
    elif [[ -f "$WT/bun.lock" ]]; then pm=bun; add install=bun.lock=node_modules "bun install" "bun install --frozen-lockfile"
    elif [[ -f "$WT/bun.lockb" ]]; then pm=bun; add install=bun.lockb=node_modules "bun install" "bun install --frozen-lockfile"
    else pm=npm; add install=package-lock.json=node_modules "npm ci" "npm ci --no-audit --no-fund"
    fi
    for s in lint typecheck check-types check test build; do
      body="$(jq -r --arg s "$s" '.scripts[$s] // empty' "$WT/package.json")"
      [[ -z "$body" || "$body" == *"no test specified"* ]] && continue
      add "" "$pm $s" "$pm run $s"
    done
  fi
  if [[ -f "$WT/go.mod" ]]; then
    add install=go.sum= "go mod download" "go mod download"
    add "" "go build" "go build ./..."
    add "" "go vet" "go vet ./..."
    add "" "go test" "go test -count=1 ./..."
  fi
  if [[ -f "$WT/Cargo.toml" ]]; then
    add "" "cargo build" "cargo build --all-targets"
    add "" "cargo test" "cargo test"
  fi
  if [[ -f "$WT/uv.lock" ]]; then
    add install=uv.lock=.venv "uv sync" "uv sync --frozen"
    add "" "pytest" "uv run pytest"
  fi
  if [[ ${#STEPS[@]} -eq 0 && -f "$WT/Makefile" ]] && grep -qE '^test:' "$WT/Makefile"; then
    add "" "make test" "make test"
  fi
fi

if [[ $SETUP_ONLY -eq 1 ]]; then
  SETUP=()
  for s in ${STEPS[@]+"${STEPS[@]}"}; do [[ "$s" == setup\|* || "$s" == install=* ]] && SETUP+=("$s"); done
  STEPS=(${SETUP[@]+"${SETUP[@]}"})
  if [[ ${#STEPS[@]} -eq 0 ]]; then
    jq -n --arg wt "$WT" '{worktree: $wt, ok: true, steps: [], notes: ["no setup steps"]}'
    exit 0
  fi
fi

if [[ ${#STEPS[@]} -eq 0 ]]; then
  jq -n --arg wt "$WT" '{worktree: $wt, ok: false, error: "no checks found: add .marrow/checks to the repo (one \"name: command\" per line)"}'
  exit 2
fi

# ---- run ----

DIRTY_BEFORE="$(git -C "$WT" status --porcelain)"
if [[ -n "$DIRTY_BEFORE" && $SETUP_ONLY -eq 0 ]]; then
  new_log "tree clean before checks"
  echo "$DIRTY_BEFORE" >"$LOG_PATH"
  record "tree clean before checks" "git status --porcelain" 1 0 "$LOG_PATH"
  note "uncommitted changes in the worktree: checks ran on them, but commit before trusting a green"
fi

for s in "${STEPS[@]}"; do
  IFS='|' read -r setup name cmd <<<"$s"
  run_step "$name" "$cmd" "$setup"
done

if [[ $SETUP_ONLY -eq 1 ]]; then
  jq -n --arg wt "$WT" --arg logs "$LOG_DIR" --argjson failed "$FAILED" --slurpfile steps "$LOG_DIR/steps.jsonl" \
    '{worktree: $wt, ok: ($failed == 0), log_dir: $logs, steps: ($steps | map(del(.tail)))}'
  [[ $FAILED -eq 0 ]]
  exit
fi

new_log "tree clean after checks"
git -C "$WT" status --porcelain >"$LOG_PATH"
if [[ -s "$LOG_PATH" && -z "$DIRTY_BEFORE" ]]; then
  record "tree clean after checks" "git status --porcelain" 1 0 "$LOG_PATH"
  note "checks left files changed or untracked; gitignore build output"
elif [[ -z "$DIRTY_BEFORE" ]]; then
  record "tree clean after checks" "git status --porcelain" 0 0 "$LOG_PATH"
fi

# Tails stay on disk, so the JSON a runner copies back stays small.
jq -r 'select(.ok | not) | "### \(.name) (exit \(.exit_code))\n\nLog: `\(.log)`\n\n```\n\(.tail)\n```\n"' \
  "$LOG_DIR/steps.jsonl" >"$LOG_DIR/failures.md"

jq -n --arg wt "$WT" --arg logs "$LOG_DIR" --arg config "$CONFIG" \
  --argjson failed "$FAILED" --argjson stopped "$STOPPED" \
  --slurpfile steps "$LOG_DIR/steps.jsonl" \
  --rawfile notes "$LOG_DIR/notes.txt" \
  '{worktree: $wt, ok: ($failed == 0 and $stopped == 0), log_dir: $logs,
    config: (if $config == "" then null else $config end),
    failures: (if $failed == 0 then null else "\($logs)/failures.md" end),
    steps: ($steps | map(del(.tail))),
    notes: ($notes | split("\n") | map(select(length > 0)))}'

[[ $FAILED -eq 0 && $STOPPED -eq 0 ]]
