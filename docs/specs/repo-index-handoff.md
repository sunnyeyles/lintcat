# Repository index — handoff

State of the work as of phases 1 and 2, for whoever picks it up next. The
design is `repo-index.md`; this file is what it does not say: what exists,
where, how to check it, and what is next.

## Where things are

| Piece | Location | Status |
|---|---|---|
| Spec | `docs/specs/repo-index.md` | phases 1–5 designed |
| Contract | `packages/index/src/types.ts` | frozen shape; additive changes only |
| Layer A (map) | `packages/index/src/layer-a/*`, `build.ts` | done, tested |
| Layer B (graph) | `packages/index/src/layer-b/*` | done for TypeScript/JavaScript via `scip-typescript` |
| In-memory index | `packages/index/src/memory.ts` | implements the full `RepositoryIndex` |
| Sources | `local-source.ts`, `github-source.ts` | filesystem walk; GitHub tree API |
| CLI | `packages/index/src/cli.ts` | `main(argv)`, `--layer-b`, `loadIndexData` |
| Tools | `packages/ai/src/agents/tools.ts` | `describe_area`, `get_symbol`, `find_references`; `find_importers` removed |
| Opening block | `packages/index/src/opening-block.ts` | rendered by `runtime.ts` after `</diff>` |
| Action wiring | `packages/reviewer/src/build-index.ts`, `apps/action/src/index.ts` | Layer A only, built live at review start; `index` input |
| Postgres | `packages/db/src/schema.ts`, `index-store.ts`, `index-rows.ts` | tables + migration `0002`; `writeIndex` atomic flip; read path. **No caller yet.** |
| Eval gate | `evals/fixtures/correctness-cross-file-caller`, `evals/src/run-fixture-review.ts` | wired; `EVAL_INDEX=off` for the A/B. **Not yet run.** |

Branches: phase 1 is PR #62 (`claude/repo-knowledge-graph-y9bc85`); phase 2
is stacked on it (`claude/repo-knowledge-graph-y9bc85-phase2`).

## How to check it

```bash
pnpm typecheck && pnpm test && pnpm build   # 10 packages, ~890 tests
pnpm vitest run packages/index               # Layer A + B, incl. a real scip-typescript run
pnpm eval                                    # needs a provider key; the phase-2 gate
EVAL_INDEX=off pnpm eval                     # the control run
```

The gate: `correctness-cross-file-caller` recall with the index versus without.
The planted bug is a return-type change whose untouched caller renders
`[object Object]`; `tsc` is clean on both trees, and `find_references` returns
the caller at `src/checkout/summary.ts:13,23`. Whether a model *uses* that is
the number nobody has yet.

Numbers on this repository: 296 files, 6,575 symbols, 12,715 references, 516
import edges, ~10 s, resolution rate 0.44 (every unresolved import is a
third-party or Node builtin).

## Decisions made in the code, not the spec

- **`references` edges are file → symbol** (`src` = referencing file, `dst` =
  symbol), not symbol → symbol as the spec first said. A reference happens at
  a line in a file, not inside another symbol.
- **`resolutionRate`** counts a non-definition occurrence of a module symbol
  (string ending in `/`) as an import statement, because `scip-typescript`
  0.4.0 never sets the `Import` role bit. See `layer-b/build.ts`.
- **Parameter symbols** are kept (`kind: "unknown"`, `exported: false`),
  about a third of all symbols. Filter at write time if the tables should not
  carry them.
- **Opening block** calls `findReferences` only when some language reports
  `indexed: true`, so Layer-A-only indexes render exactly as in phase 1.
- **`writeIndex` needs `dbSession()`**, not `db()`: neon-http cannot run the
  transaction. The pool is module-cached; a one-shot process has no way to
  close it yet.
- **Coverage jsonb** on `index_builds` is `{ layerA, languages }`; rows
  written before that shape read back with `languages: []`.

## Gotchas

- `scip-typescript --infer-tsconfig` **writes a `tsconfig.json` into the root
  when none exists.** Fine on an ephemeral clone; never point `buildLayerB` at
  a live checkout.
- The action path builds Layer A only. Layer B needs a checkout and an
  indexer, which the action deliberately does not have (README: no
  `actions/checkout`, reads happen at the base SHA over the API).
- The `RepositoryIndex` fakes in `packages/ai`, `packages/reviewer` and
  `evals` are hand-written object literals. Extending the interface means
  extending each of them; typecheck will tell you which.
- Comment rule is enforced by a hook: two lines max per comment block.

## What is next

**Phase 3 (spec):** `impact_of(path|symbol, depth)` — transitive dependents
over `imports` + `references`, depth-bounded (max 4), 500-row cap, exact
counts, `tests_reached`. In-memory: BFS over the maps `memory.ts` already
builds. Postgres: a recursive CTE over `index_edges`. Then `scip-python` and
`scip-go` as further `buildLayerB` branches keyed by language; the converter is
language-agnostic already.

**Hosted runtime (stack decided in conversation, nothing built):**
webhook receiver on Vercel (`@octokit/webhooks`), pg-boss on Neon for the
queue, one worker image with `review` and `index` roles on Fly.io (one
ephemeral machine per index job), `installation.created` /
`installation_repositories.added` / `push`-to-default-branch → index job →
clone → `buildLayerA` + `buildLayerB` → `writeIndex(dbSession(), …)` → delete
clone. The review worker then uses `createPostgresRepositoryIndex` instead of
`buildRepositoryIndex`. `apps/web` is a dashboard on mock data today; it has no
receiver, queue or worker.

**Run the gate first.** Before phase 3, get the eval numbers with a real key.
If `find_references` does not lift recall on the cross-file fixture, the spec
says stop and rethink, and that is cheaper before `impact_of` exists.

**Phase 5 (embeddings)** is designed in the spec and deliberately not started.

## Open questions carried over

- One embedding model for every team, or the team's configured provider.
- Whether the self-hosted action gets any Layer B path (would need
  `actions/checkout` at the base SHA plus the indexer in the runner).
- Monorepos with several `tsconfig.json`: one `scip-typescript` run per
  project, or one at the root with `--infer-tsconfig`.
- Whether to drop parameter symbols before they reach Postgres.
