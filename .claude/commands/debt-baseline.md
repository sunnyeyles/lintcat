---
description: Record or refresh the tech-debt baseline (all packages). Needs a worktree and a green gate, or an explicit --force reason.
argument-hint: [--force "<reason>"]
---

Record the debt baseline.

1. Confirm you are in a worktree (`.claude/rules/worktrees.md`); enter one named `debt-baseline` if not.
2. Build the bundles the size metric reads: `pnpm turbo run build --filter=@pr-review/cli --filter=@pr-review/mcp --filter=@pr-review/worker`.
3. Run `pnpm debt baseline $ARGUMENTS`. Without `--force` it refuses when the gate is red against the previous baseline; read `tooling/debt/.out/gate/report.md`, fix the regression or pass `--force "<reason>"` only when the reason is written down in that argument.
4. Commit `tooling/debt/baseline/**` alone, message `chore(debt): refresh baseline (<reason>)`, and open a PR. CI regenerates the baseline and fails if the committed files differ.

Never hand-edit a file under `tooling/debt/baseline/`.
