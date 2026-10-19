---
description: Feedback loop - turn an approved debt PR's conventions proposal into a rule so the category cannot come back.
argument-hint: <issue or pr number>
---

Read the reviewer's "Conventions proposal" on #$ARGUMENTS (`gh pr view --comments`). Apply the smallest rule it names, in a worktree named `debt-conventions-$ARGUMENTS`:

1. **Scan rule** (`tooling/debt/debt.config.json`): add or tighten a `lineRules` entry, or an exclusion that is now wrong. Add a case to `tooling/debt/src/scan/scan.test.ts`. The gate ratchets it from the next baseline.
2. **Graduation**: when `pnpm debt scan` shows a category at zero across every package, turn it into an ESLint `error` in `packages/eslint-config/base.js` (for example `@typescript-eslint/no-non-null-assertion`), run `pnpm lint`, and delete the category from `debt.config.json`. CI now blocks it; the scan no longer needs to.
3. **Prose** (`AGENTS.md` or a package `AGENTS.md`): one line, only when no deterministic rule can express it. Keep the "Tech debt" section a pointer, not a growing list.

Then `pnpm debt baseline` (the category set changed, so the baseline must), commit `chore(debt): <rule> (#$ARGUMENTS)` and open a PR. If the proposal says "none", say so and stop.
