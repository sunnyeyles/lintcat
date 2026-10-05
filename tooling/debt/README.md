# Tech-debt program

Reduce debt, harden and simplify without changing behaviour. Deterministic
parts live here; the roles that need judgment are Claude Code subagents in
`.claude/agents/`, driven by the `/debt-*` commands.

## A cycle

```
/debt-discover   -> tooling/debt/.out/DISCOVERY.md          (read-only)
/debt-plan       -> GitHub Issues: tech-debt, debt:<category>, ready-for-agent
/debt-execute N  -> worktree debt-N: safety-net tests, refactor, gate, PR, independent review
/debt-conventions N -> a scan rule, an ESLint rule or one AGENTS.md line
/debt-cycle      -> all of the above for one ticket; stops at the first red
```

Four roles, four agents, never the same context: `debt-discoverer` (finds),
`debt-planner` (tickets), `debt-executor` (one ticket, one PR), `debt-reviewer`
(independent verdict + conventions proposal). A human merges every PR.

## Commands

```bash
pnpm debt graph              # layers, dependents, exports; exit 1 on a cycle
pnpm debt affected [--all]   # packages changed against origin/main, plus dependents
pnpm debt scan               # every package -> .out/scan/scan.json
pnpm debt metrics [--all|--packages a,b] [--skip tests,typecheck,lint,dead-code,network]
pnpm debt gate [--all] [--allow-api-change] [--no-measure]
pnpm debt baseline [--force "<reason>"]
```

Turbo wraps the same thing with caching: `pnpm turbo run //#debt:gate`
(`debt:scan` and `debt:metrics` run first; the bundles are built because the
size metric reads them). `TURBO_SCM_BASE` sets the base branch.

## What is measured

Per package: scan hits per category (with the files), source files and lines,
tests (files, count, passed, failed), line/branch/function/statement coverage,
tsc errors, ESLint errors and warnings, knip unused files/exports/types/deps,
dependency counts, bundle bytes (cli, mcp, worker). Repo-wide, report only:
`pnpm audit` severities, `pnpm outdated` count, duplicate external versions
and total packages in the lockfile. Unmeasurable values are `null`, never a pass.

## What the gate blocks

Compared per affected package against `baseline/`:

| Check | Fails when |
|---|---|
| any scan category | count rose, or a hit appeared in a new file without the package total falling |
| long-file | an already-long file grew more than `allowedGrowthPct` |
| coverage | line coverage fell more than `gate.coverageDropPct` |
| tests | any test fails |
| typecheck / lint | error count rose (warnings warn) |
| bundle | grew more than `gate.bundleGrowthPct` |
| public-api | a `packages/*` `exports` entry disappeared (unless `--allow-api-change`) |
| cycles | the package graph has a cycle |

The report is `.out/gate/report.md`, also appended to `$GITHUB_STEP_SUMMARY`.
Categories, thresholds and exclusions: `debt.config.json`.

## Baseline

`pnpm debt baseline` measures everything, runs the gate against the previous
baseline and refuses to record a regression without `--force "<reason>"`. One
file per package under `baseline/`, plus `_overall.json` and `_meta.json`
(commit, reason). Commit them; CI regenerates and diffs. Never hand-edit.

Prefer refreshing it in CI so every baseline comes from the same environment:
the **Debt baseline** workflow (`workflow_dispatch`, `.github/workflows/debt-baseline.yml`)
measures on a runner and opens a PR with the new files. Run it after debt work
merges.

## Conventions that keep debt out

- One concern per PR, safety-net tests in their own first commit.
- `packages/*` `exports` are public API; removing one is a class C ticket.
- Branch `debt/<issue>` (or the `debt-<issue>` worktree); the Stop hook runs
  the gate there.
- When a category hits zero everywhere, promote it to an ESLint error and
  delete it from the scan (`/debt-conventions`).
