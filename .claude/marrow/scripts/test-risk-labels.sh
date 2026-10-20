#!/usr/bin/env bash
# Run risk-labels.sh over scratch diffs, one per rule, and pr-labels.sh
# against a fake gh: which labels a diff gets, moved names and .down files
# that don't count, and which labels are created and added on a PR.
#
# Usage: ./test-risk-labels.sh
set -uo pipefail

S="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

# ok <description> <command...>: passes when the command succeeds.
ok() {
  local what="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS $what"
  else
    echo "FAIL $what"
    FAILS=$((FAILS + 1))
  fi
}
not() { ! "$@"; }
is() { [[ "$1" == "$2" ]]; }

R="$TMP/repo"
git init -q -b main "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
mkdir -p "$R/src" "$R/db/migrations" "$R/k8s" "$R/.github/workflows"
echo 'const a = process.env.OLD_NAME' >"$R/src/config.ts"
echo 'name: ci' >"$R/.github/workflows/ci.yml"
git -C "$R" add -A
git -C "$R" commit -q -m base
BASE="$(git -C "$R" rev-parse HEAD)"

# commit <message>: commit everything and print the new head.
commit() { git -C "$R" add -A && git -C "$R" commit -q -m "$1" && git -C "$R" rev-parse HEAD; }
labels() { "$S/risk-labels.sh" "$R" "$1" "$2" | jq -c '[.labels[].name]'; }
keys() { "$S/risk-labels.sh" "$R" "$1" "$2" | jq -c --arg l "$3" '[.labels[] | select(.name == $l) | .items[].key]'; }

echo 'export const x = 1' >"$R/src/plain.ts"
PLAIN="$(commit plain)"
ok "a diff with no risk gets no labels" is "$(labels "$BASE" "$PLAIN")" '[]'

cat >"$R/src/config.ts" <<'EOF'
const a = process.env.RENAMED_LATER
const b = process.env["API_KEY"]
const c = import.meta.env.VITE_URL
const d = process.env.NODE_ENV
EOF
echo 'const t = process.env.ONLY_IN_TESTS' >"$R/src/config.test.ts"
echo 'v := os.Getenv("GO_VAR")' >"$R/src/main.go"
echo 'x = os.environ.get("PY_VAR")' >"$R/src/app.py"
printf 'FROM_ENV_FILE=1\n' >"$R/.env.example"
ENV="$(commit env)"
ok "new env vars in code, .env files, not tests or NODE_ENV" \
  is "$(keys "$BASE" "$ENV" needs-env)" '["API_KEY","FROM_ENV_FILE","GO_VAR","PY_VAR","RENAMED_LATER","VITE_URL"]'
grep -v API_KEY "$R/src/config.ts" >"$R/src/config.tmp" && mv "$R/src/config.tmp" "$R/src/config.ts"
echo 'export const key = process.env["API_KEY"]' >"$R/src/keys.ts"
MOVED="$(commit moved)"
ok "a name only moved isn't new" is "$(keys "$ENV" "$MOVED" needs-env)" '[]'

cat >"$R/k8s/deploy.yaml" <<'EOF'
env:
  - name: K8S_VAR
    valueFrom:
      secretKeyRef:
        key: value
        name: db-password
EOF
cat >"$R/.github/workflows/ci.yml" <<'EOF'
name: ci
env:
  TOKEN: ${{ secrets.DEPLOY_TOKEN }}
  GH: ${{ secrets.GITHUB_TOKEN }}
EOF
echo 'gcloud run deploy api --set-secrets STRIPE=stripe-key:latest' >"$R/deploy.sh"
SEC="$(commit secrets)"
ok "secretKeyRef, --set-secrets and workflow secrets, not GITHUB_TOKEN" \
  is "$(keys "$MOVED" "$SEC" needs-secret)" '["DEPLOY_TOKEN","db-password","stripe-key"]'
ok "and the k8s env var" is "$(keys "$MOVED" "$SEC" needs-env)" '["K8S_VAR"]'

echo 'CREATE TABLE carts (id int);' >"$R/db/migrations/001_carts.up.sql"
MIG="$(commit migration)"
ok "a new migration is labelled" is "$(labels "$SEC" "$MIG")" '["db-migration"]'
ok "and notes the missing .down.sql" is "$("$S/risk-labels.sh" "$R" "$SEC" "$MIG" | jq -r '.labels[0].items[0].note')" "no matching .down.sql in this diff"

printf -- '-- drop table old: a comment\nALTER TABLE carts DROP COLUMN legacy;\n' >"$R/db/migrations/002_trim.up.sql"
echo 'DROP TABLE carts;' >"$R/db/migrations/002_trim.down.sql"
DROP="$(commit destructive)"
ok "a DROP COLUMN in an up migration is destructive, not a comment or the .down file" \
  is "$(keys "$MIG" "$DROP" destructive-migration)" '["ALTER TABLE carts DROP COLUMN legacy;"]'
ok "both labels together, sorted" is "$(labels "$MIG" "$DROP")" '["db-migration","destructive-migration"]'

ok "it refuses missing arguments" not "$S/risk-labels.sh" "$R" "$BASE"
ok "it fails on a bad revision" not "$S/risk-labels.sh" "$R" "$BASE" nope

# The fake gh logs each call; "label list" prints the names in $GH_LABELS.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'SH'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
[[ "$1 $2" == "label list" ]] && printf '%s\n' $GH_LABELS
exit 0
SH
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH" GH_LOG="$TMP/gh.log" GH_LABELS="db-migration bug"
URL=https://github.com/acme/shop/pull/7

out="$("$S/pr-labels.sh" "$R" "$URL" "$MIG" "$DROP")"
ok "pr-labels reports the labels" is "$(jq -c .labels <<<"$out")" '["db-migration","destructive-migration"]'
ok "creates only the missing one" is "$(grep -c '^label create' "$GH_LOG")" 1
ok "with its colour and description" grep -q '^label create destructive-migration -R acme/shop --color 000000 --description Migration drops' "$GH_LOG"
ok "and adds both to the PR" grep -qx "pr edit $URL --add-label db-migration,destructive-migration" "$GH_LOG"
: >"$GH_LOG"
ok "a PR with no risk gets no gh calls" is "$("$S/pr-labels.sh" "$R" "$URL" "$BASE" "$PLAIN" | jq -c .labels)$(cat "$GH_LOG")" '[]'
ok "pr-labels refuses a URL that isn't a GitHub PR" not "$S/pr-labels.sh" "$R" https://example.com/x "$BASE" "$PLAIN"

echo
if [[ $FAILS -eq 0 ]]; then echo "all passed"; else echo "$FAILS failed"; fi
[[ $FAILS -eq 0 ]]
