# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Work in a worktree

**Before making any code change, call `EnterWorktree` and work there.** Do not
edit files in the main checkout. `EnterWorktree` is opt-in by design — it acts
only on an explicit instruction from the user or from this file — so this
paragraph is what turns it on for this repo.

The exceptions are narrow, and they are about the change not being code:
answering a question, reading the tree, or editing this file and the hooks under
`.claude/` that implement the workflow below. A session already pinned to a
directory (a background job, or a subagent launched with an explicit cwd) cannot
move, and should say so rather than silently editing the main checkout.

Worktrees live at `.claude/worktrees/<name>`, gitignored, one per branch.

**A fresh worktree is not a usable checkout on its own** — it carries tracked
files and nothing else. Two gitignored things it needs arrive automatically:

- `.env.local`, via `.worktreeinclude`. That file lists gitignored paths for the
  worktree copier to bring across. It copies file _content_ — a symlink listed
  there never arrives, so keep the entries pointing at real files.
- `node_modules`, via `.claude/hooks/install-worktree-deps.sh`, a `SessionStart`
  hook that runs `pnpm install --frozen-lockfile` the first time a session opens
  in a worktree that has none. `--frozen-lockfile` is deliberate: a worktree is
  never the place to resolve new versions, and a drifted `pnpm-lock.yaml` should
  fail loudly rather than be rewritten in a checkout nobody is watching. Set
  `WORKTREE_INSTALL_SKIP=1` to disable it.

The install runs at session start, so it does **not** cover a worktree created
mid-session — the hook fires on the next session there. If a command fails on a
missing module in a worktree you just made, run `pnpm install` rather than
treating it as a regression.

Because worktrees sit _inside_ the main checkout, pnpm walks up to the outer
`pnpm-workspace.yaml` and warns about multiple lockfiles. That warning is how
you tell a worktree run from a main-checkout one; it is not a problem.

**A `SessionEnd` hook deletes worktrees whose work is already published.**
`.claude/hooks/cleanup-merged-worktrees.sh` removes a checkout under
`.claude/worktrees/` and its local branch once every commit it holds exists
somewhere else — on the default branch, on a remote branch, or as the head of a
pull request GitHub still knows about. An unpushed commit satisfies none of
those, and it is the one thing the hook must never destroy; uncommitted changes
and a live `claude` process holding the worktree also make it refuse. Being
unable to reach GitHub is always a reason to keep, never to remove.

The evidence is graded. A pull request sitting on exactly this tip is **strong**
and collects immediately. Merely being contained in the default branch, or on
some remote ref, is **weak** — true of a brand-new worktree that has not been
committed to yet — and collects only after `WORKTREE_CLEANUP_MIN_IDLE_HOURS`
(72) of inactivity. Every decision is logged with a reason to
`~/.claude/worktree-cleanup.log`. `WORKTREE_CLEANUP_DRY_RUN=1` removes nothing.
The ladder is tested by `bash .claude/hooks/cleanup-merged-worktrees.test.sh`,
run by hand — it builds throwaway repos and stubs `gh` on `PATH`, so it is not
part of `pnpm test`.

Worktrees outside `.claude/worktrees/` are never touched.

## Comments

Hard cap: 2 lines. One is better. None is best. Enforced by
`.claude/hooks/comment-length.sh`, which rejects any longer comment block you
add. See `.claude/rules/comments.md`.

## Imports

No `.js` suffixes. Inside a package import with `#src/foo` (package.json
`imports`); `packages/db` uses extensionless relative paths, and `apps/web`
uses `@/`.

## Design system

`packages/design` is stock shadcn/ui (`new-york`, base colour `slate`, Radix
primitives, Tailwind v4). Add or update components with the CLI from inside
that package, never by hand-writing a component or fetching files from GitHub:

```bash
cd packages/design && pnpm dlx shadcn@latest add <component>
```

The CLI mis-resolves the `#src/cn` alias and emits `from "cn"` — rewrite those
to `#src/cn` after every `add`, and drop the stray `cn` npm dependency if it
reappears in `package.json`. Re-export anything new from `src/index.ts`.

Colour comes from `@primer/primitives` (GitHub's tokens), in three layers
(see `docs/adr/0002-primer-tokens-under-shadcn.md`):

1. Primer's `light.css` and `dark.css`, imported by `src/theme.css`. Never
   edited; upgrade the package to move.
2. `src/brand.css`: the only Primer tokens we override — the teal accent
   (`#317a71`), the sand light canvases and the teal dark canvases. Values are
   plain hex, checked by `src/theme.test.ts` for WCAG contrast.
3. `src/theme.css`: shadcn's semantic names (`--background`, `--primary`,
   `--link`, …) aliased onto Primer tokens, plus the Tailwind `@theme` block.
   Components use these names only.

Colour mode is Primer's `data-color-mode` on `<html>`: `auto` follows the OS,
and the topbar toggle (`apps/web/components/shell/color-mode-toggle.tsx`)
sets `light` or `dark`, persisted in `localStorage` and restored by an inline
script before paint. No `.dark` class, no theme library; Tailwind's `dark:`
variant is a custom one keyed on that attribute. Fonts are the system stacks.

`src/tokens-guard.test.ts` fails the build on Tailwind palette classes
(`bg-gray-100`) or raw hex in app code.

Brand assets (the LintCat mark and lockup, colour and mono, and the animated
loaders) live in `apps/web/public/brand/`; `apps/web/components/shell/logo-mark.tsx`
draws the same mark from the `--brand-*` tokens for inline use, with
`animate="hover"` (the topbar) or `animate="always"` (a loading state).
Terminal spinners are in `packages/design/brand/cli/`; `pnpm spinner` demos them. `docs/tokens.css` is a separate,
unrelated palette for the standalone `docs/index.html` explainer page.

## Commands

```bash
pnpm test          # vitest run
pnpm typecheck     # pnpm -r typecheck
pnpm build         # pnpm -r build
pnpm eval          # vitest run --config evals/vitest.eval.config.ts
```

## Agent skills

### Issue tracker

GitHub Issues on `sunnyeyles/pr-review-agents`, via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root, neither of which
exists yet. See `docs/agents/domain.md`.
