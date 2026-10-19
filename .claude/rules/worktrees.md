# Work in a worktree

**Before making any change, call `EnterWorktree` and work there.** Do not
edit files in the main checkout while it is on the default branch (`main`).
`EnterWorktree` is opt-in by design, so this standing instruction is what turns
it on for this repo and authorises it without asking the user first. Use a
short kebab-case `name` describing the task.

The only exceptions are answering a question and reading the tree or git
history. A session already pinned to a directory (a background job, or a
subagent launched with an explicit cwd) cannot move, and should say so rather
than silently editing the main checkout.

Worktrees live at `.claude/worktrees/<name>`, gitignored, one per branch.

**A fresh worktree is not a usable checkout on its own** — it carries tracked
files and nothing else.

- `.env.local` arrives via `.worktreeinclude`, which lists gitignored paths for
  the worktree copier to bring across; existing files are never overwritten. It
  copies file _content_ — a symlink listed there never arrives, so keep the
  entries pointing at real files.
- `node_modules` does not. Run `pnpm install --frozen-lockfile` before the first
  command that needs it. A worktree is never the place to resolve new versions,
  so a drifted `pnpm-lock.yaml` should fail there rather than be rewritten. The
  one exception is a PR whose purpose is to add a workspace or a dependency:
  run `pnpm install --lockfile-only` once, then `--frozen-lockfile`, and say so
  in the PR.

Because worktrees sit _inside_ the main checkout, pnpm walks up to the outer
`pnpm-workspace.yaml` and warns about multiple lockfiles. That warning is how
you tell a worktree run from a main-checkout one; it is not a problem.

## Cleanup

Nothing removes worktrees automatically. Claude Code offers to keep or remove
the worktree when the session exits, and `ExitWorktree` does the same
mid-session. Remove one only when its commits are pushed or merged.
