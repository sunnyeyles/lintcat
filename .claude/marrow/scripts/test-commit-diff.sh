#!/usr/bin/env bash
# Feed sample hook JSON to commit-diff.sh against a scratch repo and a fake
# cmux, and check which commands open a diff, and where.
#
# Usage: ./test-commit-diff.sh
set -uo pipefail

D="$(cd "$(dirname "$0")" && pwd)/commit-diff.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

# The fake cmux logs each call and answers like the real one. Open workspaces
# are numbers in $CMUX_LOG.ws; workspace N has id WS-N, starts with terminal
# T-N, and its first diff lands in pane PD-N.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/cmux" <<'SH'
#!/usr/bin/env bash
echo "$*" >>"$CMUX_LOG"
arg() { local want="$1"; shift; while [[ $# -gt 1 ]]; do [[ "$1" == "$want" ]] && { echo "$2"; return; }; shift; done; }
case "$1" in
  workspace)
    if [[ "$2" == create ]]; then
      n=$(( $(cat "$CMUX_LOG.n" 2>/dev/null || echo 0) + 1 ))
      echo "$n" >"$CMUX_LOG.n"
      echo "$n" >>"$CMUX_LOG.ws"
      echo "OK workspace:$n"
    else
      while read -r n; do echo "  workspace:$n WS-$n  Commit diffs"; done <"$CMUX_LOG.ws"
    fi ;;
  list-pane-surfaces)
    ws="$(arg --workspace "$@")" pane="$(arg --pane "$@")"
    n="${ws#WS-}"
    grep -qx "$n" "$CMUX_LOG.ws" 2>/dev/null || { echo "Error: not_found"; exit 1; }
    if [[ -z "$pane" ]]; then echo "{\"surfaces\":[{\"id\":\"T-$n\"}]}"
    elif [[ "$pane" == "PD-$n" ]]; then echo "{\"surfaces\":[{\"id\":\"D-$n\"}]}"
    else echo "Error: not_found"; exit 1; fi ;;
  diff)
    cat >"$CMUX_LOG.patch"
    ws="$(arg --workspace "$@")"
    echo "OK surface=D-new pane=PD-${ws#WS-}" ;;
  *) echo OK ;;
esac
SH
chmod +x "$TMP/bin/cmux"
export PATH="$TMP/bin:$PATH" CMUX_SURFACE_ID=surface:5 CMUX_LOG="$TMP/cmux.log" XDG_STATE_HOME="$TMP/state"

R="$TMP/repo"
git init -q "$R"
git -C "$R" config user.email t@example.com
git -C "$R" config user.name t

# t <want> <description> <cwd> <command>
# Runs the command in cwd, as the Bash tool would, then the hook. want is
# "new WS-N PD-N" (made workspace N), "tab WS-N PD-N" (a tab in it) or "none".
t() {
  local want="$1" what="$2" cwd="$3" cmd="$4" got
  : >"$CMUX_LOG"
  (cd "$cwd" && bash -c "$cmd") >/dev/null 2>&1
  jq -n --arg c "$cmd" --arg d "$cwd" '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}' | "$D"
  if grep -q '^workspace create' "$CMUX_LOG" && grep -q '^close-surface --surface T-' "$CMUX_LOG"; then
    got="new $(cat "$XDG_STATE_HOME/marrow/diff-workspace")"
  elif grep -q '^move-surface ' "$CMUX_LOG"; then
    got="tab $(sed -n 's/^move-surface --surface D-new --pane \([^ ]*\) --workspace \([^ ]*\) .*/\2 \1/p' "$CMUX_LOG")"
  elif [[ -s "$CMUX_LOG" ]]; then
    got="other: $(tr '\n' ';' <"$CMUX_LOG")"
  else
    got=none
  fi
  if [[ "$got" == "$want" ]]; then
    printf 'PASS %-14s %s\n' "$got" "$what"
  else
    printf 'FAIL %-14s %s (wanted %s)\n' "$got" "$what" "$want"
    FAILS=$((FAILS + 1))
  fi
}

echo one >"$R/a.txt"
t "new WS-1 PD-1" "the first commit makes the workspace" "$TMP" "git -C $R add -A && git -C $R commit -qm 'Add a'"
grep -q '^+one$' "$CMUX_LOG.patch" || { echo "FAIL the patch is missing the commit's change"; FAILS=$((FAILS + 1)); }
grep -q -- '--title [0-9a-f]* Add a' "$CMUX_LOG" || { echo "FAIL the title isn't '<sha> <subject>'"; FAILS=$((FAILS + 1)); }
t none "the same HEAD again" "$TMP" "git -C $R commit -qm 'nothing to commit'"
t none "a command with no commit" "$R" "git -C $R status && echo commit"
t none "a commit in another repo" "$TMP" "git -C $TMP/bin commit -qm x"

echo two >"$R/b.txt"
t "tab WS-1 PD-1" "cd <repo> && git commit" "$TMP" "cd $R && git add -A && GIT_EDITOR=true git commit -qm 'Add b'"
echo three >"$R/c.txt"
t "tab WS-1 PD-1" "git -c ... commit from the repo's cwd" "$R" "git add -A; git -c core.quotepath=off commit -qm 'Add c'"

: >"$CMUX_LOG.ws"
echo four >"$R/d.txt"
t "new WS-2 PD-2" "a commit after the workspace was closed" "$R" "git add -A && git commit -qm 'Add d'"
echo five >"$R/e.txt"
t "tab WS-2 PD-2" "the next commit joins the new workspace" "$R" "git add -A && git commit -qm 'Add e'"

echo six >"$R/f.txt"
git -C "$R" add -A
GIT_COMMITTER_DATE="2001-01-01T00:00:00Z" git -C "$R" commit -qm 'Add f'
t none "a HEAD committed long ago" "$R" "git commit -qm 'nothing to commit'"

echo seven >"$R/g.txt"
git -C "$R" add -A
(unset CMUX_SURFACE_ID; t none "outside cmux" "$R" "git commit -qm 'Add g'")

echo
if [[ $FAILS -eq 0 ]]; then echo "all passed"; else echo "$FAILS failed"; fi
[[ $FAILS -eq 0 ]]
