# AGENTS.md

Guidance for coding agents working in this repository. Package-specific rules
live in nested `AGENTS.md` files beside the code they govern:

- `apps/web/AGENTS.md`: the dashboard's data seam, route guards, brand assets
- `packages/ai/AGENTS.md`: the agent's tools, prompt and model providers
- `packages/db/AGENTS.md`: schema changes, migrations, transactions
- `packages/design/AGENTS.md`: shadcn, icons, colour tokens
- `evals/AGENTS.md`: the paid, model-backed quality suite
- `tooling/debt/AGENTS.md`: the tech-debt scan, baseline and gate

## Architecture

An AI pull-request reviewer, run as a GitHub App on each organization's own
model key. One pipeline, four front ends:

- `apps/web` (Next.js): docs site, dashboard, and the GitHub webhook, which
  enqueues a row in `review_jobs`.
- `apps/worker` (Cloud Run): claims jobs from that table, runs the pipeline with
  the org's decrypted key, publishes the check run and inline comments.
- `apps/cli` and `apps/mcp`: the same pipeline over a local working tree.

The pipeline lives in `packages/reviewer` (`review-run.ts`). It builds a
repository index at the base commit (`packages/index`), then runs **one**
`general` agent (`packages/ai/src/agents/`) through a capped tool loop with
read-only tools only.

**The trust boundary is the core invariant:** agent output is untrusted until
deterministic code validates it. `validateFindings()` (schema, own category,
added lines only, confidence ≥ 0.70, dedupe, cap 10) and `verifyPatches()`
(`expected` text must match the head commit byte for byte) sit between the
model and GitHub. Never let model output reach the GitHub API unvalidated. The
check run is always advisory (`neutral`).

Other packages: `db` (Drizzle/Postgres schema, job queue, encrypted model
keys), `github` (installation-token Octokit client), `schemas` (Zod contracts),
`logging` (single-line JSON). `evals/` runs the real pipeline against fixture
repos without touching GitHub.

## Commands

```bash
pnpm test          # vitest run, every workspace as a project; never calls a model
pnpm typecheck     # turbo run typecheck
pnpm lint          # turbo run lint (ESLint, config in packages/eslint-config)
pnpm build         # turbo run build (esbuild bundles cli/mcp/worker, next build for web)
pnpm dev           # turbo run dev
pnpm dead-code     # knip
pnpm debt gate     # tech-debt gate on affected packages; pnpm debt --help for the rest
pnpm eval          # model-backed *.eval.ts suite: real tokens, needs a provider key
pnpm db:generate   # also db:migrate, db:push, db:studio (drizzle-kit in packages/db)
```

One file or one test: `pnpm vitest run packages/reviewer/src/validate-findings.test.ts`,
adding `-t "<test name>"` to narrow further.

`*.test.ts` sit beside their sources. `*.conformance.test.ts` hold a fake to
the same contract as the real implementation it stands in for.

## Imports

No `.js` suffixes. Inside a package import with `#src/foo` (package.json
`imports`). `packages/db` and `apps/web` differ; see their `AGENTS.md`.

## Colour

App code uses the semantic colour tokens only: no Tailwind palette classes
(`bg-gray-100`) and no raw hex. `packages/design/src/tokens-guard.test.ts`
fails the build on either. See `packages/design/AGENTS.md`.

## Comments

**Hard cap: 2 lines. One is better. None is best.** For Claude Code,
`.claude/hooks/comment-length.sh` enforces it after every edit.

Say the one non-obvious fact in plain words. Nothing else.

Never write:

- essays, or any block that reads like prose
- why you did _not_ do something, or what the code used to do
- a restatement of the code, the type signature, or the API contract
- ticket references (PROD-XXXX, #123)
- API usage that belongs at the API's own definition

Fix a stale comment by rewriting it. Never add a second comment beside it.

Bad:

```ts
/**
 * Names too common to identify anything, so searching one returns only
 * noise. A heuristic snapshot of the usual conventions, not a rule — the
 * `totalCount` in every result is what actually shows the model how noisy
 * its query was. Split by position: `packages.ts` is a real file name, and
 * `main/` a real directory, so neither list may judge the other's slot.
 */
```

Good:

```ts
// Split by position: a file-name list must not judge a directory slot.
```

`COMMENT_LINT_SKIP=1` turns the hook off. It is for the rare false positive
(comment-like text inside a template literal), not for writing longer comments.

## Tech debt

An autonomous, behaviour-preserving loop. Deterministic parts are
`tooling/debt` (Turborepo root tasks `//#debt:scan|metrics|gate|baseline`);
judgment parts are the `debt-*` subagents in `.claude/agents/`, driven by
`/debt-discover`, `/debt-plan`, `/debt-execute <issue>`, `/debt-review`,
`/debt-conventions`, `/debt-cycle`. How to run a cycle: `tooling/debt/README.md`.

**Gate.** CI runs `pnpm turbo run //#debt:gate` on the affected packages and
fails on: a scan category count rising (or a hit in a new file without a net
fall), an already-long file growing, line coverage dropping, failing tests,
more tsc or ESLint errors, bundle growth, a removed `packages/*` export, a
package cycle, or `tooling/*` depending on a product package. Categories and
thresholds: `tooling/debt/debt.config.json`.
Vulnerabilities, outdated and duplicate dependencies are reported, not gated.

**Conventions.**

- Four roles, four contexts: discovery, planning, execution and review never
  share a session. The reviewer is read-only. A human merges.
- One concern per PR. Safety-net tests land first, in their own commit, and
  pass on the unchanged code.
- `packages/*` `exports` are public API. Removing or changing one is a class C
  ticket and needs `--allow-api-change` plus an API note in the PR.
- `tooling/debt/baseline/**` is generated by `pnpm debt baseline`, never
  edited by hand. CI regenerates it and fails on a diff.
- Debt work happens on a `debt-<issue>` worktree (`debt/<issue>` branch); the
  Stop hook runs the gate there.
- Feedback loop: a category at zero everywhere graduates to an ESLint error in
  `packages/eslint-config/base.js` and leaves the scan. Prose rules here are
  the last resort.

## Agent skills

### Issue tracker

GitHub Issues on `sunnyeyles/lintcat`, via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` (not written yet) at the repo root. See
`docs/agents/domain.md`. This repo keeps no ADRs; don't create `docs/adr/`.
