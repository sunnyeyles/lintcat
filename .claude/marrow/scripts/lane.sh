#!/usr/bin/env bash
# Deterministic git plumbing for marrow worktrees, run by marrow-runner.
# Every subcommand prints JSON on stdout.
#
# Usage:
#   lane.sh create <main-checkout> <start-ref> <worktree> <branch> [--fresh]
#       Make (or reuse, when clean and on <branch>) a worktree on <branch>,
#       starting it at <start-ref>, then run checks.sh --setup-only in it.
#       With no local <branch>, an origin/<branch> (fetched first) is used
#       instead of <start-ref>: a rerun on a new machine picks up the
#       tickets an earlier run merged and pushed. "from" says which.
#       --fresh discards any existing worktree and branch first (ticket lanes
#       are disposable; merged work lives on the integration branch).
#       "base" is the merge-base of <start-ref> and the worktree's HEAD.
#   lane.sh detach <main-checkout> <worktree> <sha>
#       Make a detached worktree at <sha> for a review, or move an existing
#       clean, detached one there. Refuses a dirty one, one on a branch (a
#       build's worktree can share the name), and a path that isn't a worktree.
#   lane.sh lock <worktree> <lock-json>
#       Write the file lock guard.sh reads: {"owns": [...], "tests": [...],
#       "test_helpers": [...], "locked": [...]}. "{}" clears it.
#   lane.sh merge <into-worktree> <branch> <message> [tests-commit]
#       Merge <branch> into the worktree's branch with --no-ff, adding a
#       "Tests-commit:" trailer when given. On conflict the merge is left in
#       progress (its message kept) and the conflicted files are listed.
#   lane.sh settle <worktree>
#       After a conflict resolution: ok when no merge or rebase is in
#       progress; otherwise abort it and report that.
#   lane.sh merged <worktree>
#       Ticket ids already merged on the worktree's branch ("Merge ticket NN:"),
#       and each one's tests commit from the merge's "Tests-commit:" trailer.
#   lane.sh remove <main-checkout> <worktree> [branch]
#       Remove a marrow worktree, and delete its marrow/* branch if given.
#
# Exit 0 ok, 1 failed (see "error"), 2 on misuse.
set -uo pipefail

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

out() { jq -n "$@"; }
die() { out --arg e "$1" '{ok: false, error: $e}'; exit 1; }
usage() { echo "usage: lane.sh create|detach|lock|merge|settle|merged|remove ... (see the header)" >&2; exit 2; }

marrow_wt() { [[ "$1" == */.claude/worktrees/marrow-* ]]; }
# own_worktree <path>: <path> is the top of a linked worktree. Without this, git
# -C on a plain directory inside the main checkout would act on the main checkout.
own_worktree() {
  local top gitdir common
  top="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || return 1
  gitdir="$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)" || return 1
  common="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  [[ "$top" == "$(cd -P "$1" && pwd)" && "$gitdir" != "$common" ]]
}
# Keep the worktrees out of the main checkout's git status.
exclude_worktrees() {
  local info
  info="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/info"
  git -C "$1" check-ignore -q --no-index .claude/worktrees/ || { mkdir -p "$info" && echo ".claude/worktrees/" >>"$info/exclude"; }
}

case "${1:-}" in
  create)
    [[ $# -eq 5 || ( $# -eq 6 && "$6" == --fresh ) ]] || usage
    MAIN="$2" START="$3" WT="$4" BRANCH="$5"
    marrow_wt "$WT" || die "worktree must be under .claude/worktrees/marrow-*"
    [[ "$BRANCH" == marrow/* ]] || die "branch must be marrow/*"
    git -C "$MAIN" worktree prune
    if [[ "${6:-}" == --fresh ]]; then
      [[ -e "$WT" ]] && { git -C "$MAIN" worktree remove --force "$WT" >&2 || die "could not remove the old $WT"; }
      git -C "$MAIN" branch -D "$BRANCH" >/dev/null 2>&1 || true
    fi
    exclude_worktrees "$MAIN"
    reused=false
    from=local
    if [[ -e "$WT" ]]; then
      own_worktree "$WT" || die "$WT exists but is not a worktree; not touching it"
      [[ "$(git -C "$WT" rev-parse --abbrev-ref HEAD 2>/dev/null)" == "$BRANCH" ]] || die "$WT exists but is not on $BRANCH"
      [[ -z "$(git -C "$WT" status --porcelain)" ]] || die "$WT has uncommitted changes; not touching it"
      reused=true
    elif git -C "$MAIN" show-ref --verify -q "refs/heads/$BRANCH"; then
      git -C "$MAIN" worktree add -q "$WT" "$BRANCH" >&2 || die "worktree add failed"
      reused=true
    else
      # Ticket lanes (--fresh) are never pushed, so only the integration branch looks for one.
      [[ "${6:-}" == --fresh ]] || git -C "$MAIN" fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" >/dev/null 2>&1 || true
      if [[ "${6:-}" != --fresh ]] && git -C "$MAIN" show-ref --verify -q "refs/remotes/origin/$BRANCH"; then
        git -C "$MAIN" worktree add -q -b "$BRANCH" "$WT" "origin/$BRANCH" >&2 || die "worktree add -b $BRANCH from origin/$BRANCH failed"
        reused=true
        from=origin
      else
        git -C "$MAIN" worktree add -q -b "$BRANCH" "$WT" "$START" >&2 || die "worktree add -b $BRANCH from $START failed"
        from=start
      fi
    fi
    setup="$("$HERE/checks.sh" --setup-only "$WT" 2>/dev/null)"
    rc=$?
    base="$(git -C "$WT" merge-base "$START" HEAD 2>/dev/null || git -C "$WT" rev-parse HEAD)"
    out --arg wt "$WT" --arg b "$BRANCH" --arg head "$(git -C "$WT" rev-parse HEAD)" --arg base "$base" --argjson reused "$reused" \
      --argjson rc "$rc" --arg setup "$setup" --arg from "$from" \
      '{ok: ($rc == 0 or $rc == 2), worktree: $wt, branch: $b, head: $head, base: $base, reused: $reused, from: $from,
        setup: (try ($setup | fromjson) catch $setup)}'
    [[ $rc -eq 0 || $rc -eq 2 ]]
    ;;
  detach)
    [[ $# -eq 4 ]] || usage
    MAIN="$2" WT="$3" SHA="$4"
    marrow_wt "$WT" || die "worktree must be under .claude/worktrees/marrow-*"
    git -C "$MAIN" worktree prune
    exclude_worktrees "$MAIN"
    if [[ -e "$WT" ]]; then
      own_worktree "$WT" || die "$WT exists but is not a worktree; not touching it"
      ! git -C "$WT" symbolic-ref -q HEAD >/dev/null || die "$WT is on a branch, so another run owns it; not touching it"
      [[ -z "$(git -C "$WT" status --porcelain)" ]] || die "$WT has uncommitted changes; not touching it"
      git -C "$WT" checkout --detach --quiet "$SHA" >&2 || die "checkout of $SHA in $WT failed"
    else
      git -C "$MAIN" worktree add -q --detach "$WT" "$SHA" >&2 || die "worktree add --detach $SHA failed"
    fi
    out --arg wt "$WT" --arg head "$(git -C "$WT" rev-parse HEAD)" '{ok: true, worktree: $wt, head: $head}'
    ;;
  lock)
    [[ $# -eq 3 ]] || usage
    WT="$2"
    jq -e 'type == "object"' <<<"$3" >/dev/null 2>&1 || die "lock must be a JSON object"
    gitdir="$(git -C "$WT" rev-parse --absolute-git-dir 2>/dev/null)" || die "not a worktree: $WT"
    [[ "$gitdir" == */worktrees/* ]] || die "refusing to lock a main checkout"
    if [[ "$3" == "{}" ]]; then rm -f "$gitdir/marrow-lock.json"; else jq . <<<"$3" >"$gitdir/marrow-lock.json"; fi
    out --arg f "$gitdir/marrow-lock.json" '{ok: true, lock_file: $f}'
    ;;
  merge)
    [[ $# -eq 4 || $# -eq 5 ]] || usage
    WT="$2" BRANCH="$3" MSG=(-m "$4")
    [[ -n "${5:-}" ]] && MSG+=(-m "Tests-commit: $5")
    [[ -z "$(git -C "$WT" status --porcelain --untracked-files=no)" ]] || die "$WT has uncommitted changes"
    if git -C "$WT" merge --no-ff -q "${MSG[@]}" "$BRANCH" >&2; then
      out --arg head "$(git -C "$WT" rev-parse HEAD)" '{ok: true, conflict: false, head: $head}'
    else
      files="$(git -C "$WT" diff --name-only --diff-filter=U | jq -R . | jq -s .)"
      if [[ "$files" == "[]" ]]; then
        git -C "$WT" merge --abort 2>/dev/null
        die "merge of $BRANCH failed without conflicts"
      fi
      out --argjson f "$files" '{ok: false, conflict: true, files: $f, error: "merge conflict; the merge is left in progress"}'
      exit 1
    fi
    ;;
  settle)
    [[ $# -eq 2 ]] || usage
    WT="$2"
    gitdir="$(git -C "$WT" rev-parse --absolute-git-dir 2>/dev/null)" || die "not a worktree: $WT"
    if [[ -e "$gitdir/MERGE_HEAD" ]]; then
      git -C "$WT" merge --abort >&2 2>/dev/null
      out '{ok: false, aborted: "merge", error: "a merge was still in progress; aborted it"}'
      exit 1
    fi
    if [[ -d "$gitdir/rebase-merge" || -d "$gitdir/rebase-apply" ]]; then
      git -C "$WT" rebase --abort >&2 2>/dev/null
      out '{ok: false, aborted: "rebase", error: "a rebase was still in progress; aborted it"}'
      exit 1
    fi
    [[ -z "$(git -C "$WT" status --porcelain --untracked-files=no)" ]] || die "uncommitted changes after the resolution"
    out --arg head "$(git -C "$WT" rev-parse HEAD)" '{ok: true, head: $head}'
    ;;
  merged)
    [[ $# -eq 2 ]] || usage
    # One line per commit: the subject, a unit separator, then any Tests-commit trailer.
    git -C "$2" log --format='%s%x1f%(trailers:key=Tests-commit,valueonly,separator=%x20)' 2>/dev/null |
      jq -R -s '[split("\n")[] | split("\u001f") | select((.[0] // "") | test("^Merge ticket [0-9]+:"))
          | {id: (.[0] | capture("^Merge ticket (?<id>[0-9]+):").id), tc: ((.[1] // "") | gsub("\\s"; ""))}] as $r
        | {ok: true, merged: ($r | map(.id) | unique),
           tests_commits: ($r | map(select(.tc != "")) | reverse | map({(.id): .tc}) | add // {})}'
    ;;
  remove)
    [[ $# -ge 3 ]] || usage
    MAIN="$2" WT="$3" BRANCH="${4:-}"
    marrow_wt "$WT" || die "only .claude/worktrees/marrow-* worktrees are removed"
    git -C "$MAIN" worktree prune
    [[ -e "$WT" ]] && { git -C "$MAIN" worktree remove --force "$WT" >&2 || die "worktree remove failed"; }
    if [[ -n "$BRANCH" ]]; then
      [[ "$BRANCH" == marrow/* ]] || die "only marrow/* branches are deleted"
      git -C "$MAIN" branch -D "$BRANCH" >&2 2>/dev/null || true
    fi
    out '{ok: true}'
    ;;
  *) usage ;;
esac
