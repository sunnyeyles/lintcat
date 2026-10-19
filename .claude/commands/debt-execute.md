---
description: Execute one tech-debt ticket end to end in its own worktree (safety net, refactor, gate, PR), then review it independently.
argument-hint: <issue number>
---

Ticket: #$ARGUMENTS. Refuse without a number.

1. `EnterWorktree` named `debt-$ARGUMENTS`, then `pnpm install --frozen-lockfile` there.
2. Launch the `debt-executor` subagent with the issue number and the worktree path. It writes the safety-net tests first, refactors, runs `pnpm debt gate`, and opens a `tech-debt` PR. It must not create worktrees or merge.
3. When it returns with a PR URL, launch the `debt-reviewer` subagent on that PR in a fresh context. It posts APPROVE or REQUEST-CHANGES with a conventions proposal.
4. On REQUEST-CHANGES, send the findings back to the executor once; a second REQUEST-CHANGES ends the cycle and the PR stays open for a human.
5. On APPROVE, run `/debt-conventions $ARGUMENTS` and report the PR URL, gate deltas and the proposal. A human merges.

If the executor stops because the gate is red or the scope was wrong, report that verbatim; never `--force`, never edit the baseline.
