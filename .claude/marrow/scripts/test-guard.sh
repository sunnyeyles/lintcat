#!/usr/bin/env bash
# Feed sample hook JSON to guard.sh and check each verdict.
#
# Usage: ./test-guard.sh
set -uo pipefail

G="$(cd "$(dirname "$0")" && pwd)/guard.sh"
W=/u/app/.claude/worktrees/marrow-feat-x
SHA=0123456789abcdef0123456789abcdef01234567
FAILS=0

t() {
  local mode="$1" want="$2" cmd="$3" out rc got
  out=$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | "$G" "$mode" 2>&1)
  rc=$?
  if [[ $rc -eq 0 ]]; then got=allow; else got=block; fi
  if [[ "$got" == "$want" ]]; then
    printf 'PASS %-9s %-5s %s\n' "$mode" "$got" "$cmd"
  else
    printf 'FAIL %-9s %-5s %s\n     %s\n' "$mode" "$got" "$cmd" "$out"
    FAILS=$((FAILS + 1))
  fi
}

t git-sync allow "git -C $W push -u origin marrow/feat-x"
t git-sync allow "git -C $W push --force-with-lease=marrow/feat-x:$SHA origin marrow/feat-x"
t deny-push block "git -C $W push -u origin marrow/feat-x"
t git-sync block "git -C $W push --force-with-lease=marrow/other:$SHA origin marrow/feat-x"
t git-sync block "git -C $W push --force origin marrow/feat-x"
t git-sync block "git -C /u/app push -u origin marrow/feat-x"
t git-sync block "git -C $W push -u origin marrow/feat-x:main"
t git-sync block "git push origin HEAD:main"
t git-sync block "git push --force"
t git-sync block "git -C x push origin marrow/a && git push origin main"
t git-sync block "git -C $W push -u origin marrow/feat-x && git push origin main"
t git-sync block "git -C $W push -u origin marrow/feat-x; git push origin main"
t git-sync block "git -C $W push -u origin marrow/feat-x | git push origin main"
t git-sync block "git -C $W push -u origin marrow/feat-x
git push origin main"
t git-sync block "(git push origin main)"
t git-sync block "echo \$(git push origin main)"
t git-sync block "sh -c 'git push origin main'"
t git-sync block "bash -lc \"cd /tmp && git push\""
t git-sync block "FOO=1 env -u BAR /usr/bin/git -C /tmp push"
t git-sync block "echo main | xargs -I{} git push origin {}"
t git-sync block "git -c alias.p=push p origin main"
t git-sync block "gh pr merge 1"
t deny-push block "git config alias.p push"
t deny-push allow "git config --get alias.p"
t git-sync block "gh pr -R acme/app merge 1"
t deny-push block "gh pr --repo acme/app merge 1"
t deny-push block "gh -R acme/app pr merge 1"
t deny-push block "gh pr -R acme/app create --title x"
t git-sync block "gh pr -R acme/app create --title 'Add x' --body-file /tmp/b.md"
t deny-push block "env -S 'git push origin main'"
t deny-push block "env --split-string='git push origin main'"
t deny-push allow "gh pr -R acme/app view 1"
t git-sync block "gh api -X POST repos/acme/app/pulls/1/merge"
t git-sync block "gh api repos/acme/app/issues/1/labels -f labels[]=x"
t git-sync block "gh api graphql -f query='mutation { x }'"
t git-sync allow "gh api repos/acme/app/pulls/1"
t git-sync allow "gh api -X GET search/issues -f q=repo:acme/app"
t git-sync block "git branch -D main"
t git-sync block "git -C $W branch -D marrow/x main"
t git-sync allow "git branch -D marrow/x"
t git-sync block "git reset --hard origin/main"
t git-sync block "git clean -fdx"
t git-sync block "git checkout -- ."
t git-sync allow "git -C $W rebase origin/main"
t git-sync block "gh pr create --title 'Page the board' --body-file /tmp/b.md"
t git-sync block "gh pr edit 12 --body-file /tmp/b.md"
t git-sync allow "gh pr view marrow/feat-x --json number,state"
t git-sync block "gh pr close 12"
t git-sync block "gh label create caution"
t git-sync allow "git worktree remove $W"
t git-sync block "git worktree remove /u/app"
t git-sync block "git worktree remove /u/app/.claude/worktrees/my-feature"
t git-sync block "git -C /u/app/.claude/worktrees/my-feature push -u origin marrow/feat-x"
t deny-push block "git push origin HEAD:main"
t deny-push block "gh pr create --title x --body y"
t deny-push block "gh api -X POST repos/x/y/issues"
t deny-push block "git commit -m 'unbalanced && git push"
t deny-push allow "git commit -m 'push the fix; then merge'"
t deny-push allow "git log --grep push --oneline"
t deny-push allow "go test -p 1 ./... && git status"
t deny-push allow "gh pr view 12 --json state"
t deny-push block "time -p git push origin main"
t deny-push block "sudo -u me git push"
t deny-push block "sudo -iu me git push"
t deny-push block "command -p git push"
t deny-push block "exec -a x git push"
t deny-push block "caffeinate -i git push"
t deny-push block "nice -n 5 git push"
t deny-push block "git --config-env=alias.p=X p"
t deny-push block "git --config-env alias.p=X p"
t deny-push block "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0='!git push' git p"
t deny-push block "export GIT_CONFIG_KEY_0=alias.p"
t deny-push block "git subtree push --prefix=a origin main"
t deny-push block "git lfs push origin main"
t deny-push allow "time -p go test ./..."
t deny-push allow "command -v git"
t deny-push allow "git config get alias.p"
t deny-push allow "git subtree split --prefix=a"

# File locks: a fake worktree whose git dir holds a marrow-lock.json.
L="$(mktemp -d)"
trap 'rm -rf "$L"' EXIT
mkdir -p "$L/wt/src/api" "$L/gd" "$L/plain/.git"
echo "gitdir: $L/gd" >"$L/wt/.git"
cat >"$L/gd/marrow-lock.json" <<'JSON'
{"owns": ["src/api/**", "docs/*.md"], "tests": ["src/api/users.test.ts"], "test_helpers": ["test/fixtures/**"], "locked": ["src/api/users.test.ts"]}
JSON

e() {
  local mode="$1" want="$2" path="$3" tool="${4:-Edit}" agent="${5:-}" out rc got
  out=$(jq -n --arg p "$path" --arg t "$tool" --arg a "$agent" \
    '{tool_name:$t, tool_input:{file_path:$p}} + (if $a == "" then {} else {agent_type:$a} end)' | "$G" "$mode" 2>&1)
  rc=$?
  if [[ $rc -eq 0 ]]; then got=allow; else got=block; fi
  if [[ "$got" == "$want" ]]; then
    printf 'PASS %-11s %-5s %s %s\n' "$mode" "$got" "$tool" "${path#$L/}"
  else
    printf 'FAIL %-11s %-5s %s %s\n     %s\n' "$mode" "$got" "$tool" "${path#$L/}" "$out"
    FAILS=$((FAILS + 1))
  fi
}

e implementer allow "$L/wt/src/api/users.ts"
e implementer allow "$L/wt/src/api/deep/x.ts" Write
e implementer allow "$L/wt/docs/a.md"
e implementer block "$L/wt/docs/sub/a.md"
e implementer block "$L/wt/src/api/users.test.ts"
e implementer block "$L/wt/src/web/page.tsx"
e implementer block "$L/wt/.marrow/f/spec.md"
e implementer block "$L/wt/.claude/settings.json" Write
e implementer block "$L/plain/anything.ts"
e implementer block "$HOME/code/other/main.go"
e implementer allow "/tmp/scratch.txt" Write
e implementer allow "${TMPDIR:-/tmp}/x/notes.md" Write
e test-writer allow "$L/wt/src/api/users.test.ts" Write
e test-writer allow "$L/wt/test/fixtures/users.json" Write
e test-writer allow "$L/wt/src/api/users.ts"
e test-writer block "$L/wt/src/web/page.tsx"
e deny-push allow "$L/wt/src/web/page.tsx"
e auto block "$L/wt/src/web/page.tsx" Edit marrow-implementer
e auto block "$L/wt/src/web/x.ts" Edit marrow-test-writer
e auto allow "$L/wt/src/web/page.tsx" Edit
e auto allow "$L/wt/src/web/page.tsx" Edit general-purpose

ta() {
  local agent="$1" want="$2" cmd="$3" out rc got
  out=$(jq -n --arg c "$cmd" --arg a "$agent" '{tool_name:"Bash",tool_input:{command:$c}} + (if $a == "" then {} else {agent_type:$a} end)' | "$G" auto 2>&1)
  rc=$?
  if [[ $rc -eq 0 ]]; then got=allow; else got=block; fi
  if [[ "$got" == "$want" ]]; then
    printf 'PASS auto(%s) %-5s %s\n' "${agent:-main}" "$got" "$cmd"
  else
    printf 'FAIL auto(%s) %-5s %s\n     %s\n' "${agent:-main}" "$got" "$cmd" "$out"
    FAILS=$((FAILS + 1))
  fi
}
ta "" allow "git push origin marrow-run/f"
ta marrow-runner block "git push origin main"
ta marrow-implementer block "git push"
ta marrow-git-sync allow "git -C $W push -u origin marrow/feat-x"
ta marrow-git-sync block "git push origin main"

echo "$FAILS failed"
[[ $FAILS -eq 0 ]]
