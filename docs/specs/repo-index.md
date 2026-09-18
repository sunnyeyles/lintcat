# Repository index

A per-repository map of what is where — packages, files, symbols, and the
resolved references between them — built and stored by the hosted GitHub App
and exposed to the review agents as read-only tools. This is the thing the paid
tier has that the self-hosted action does not.

## Goals

- Answer, truthfully, the questions the agents already try to ask:
  *who imports this*, *where is this defined*, *what breaks if this changes*.
- Zero customer setup beyond installing the App and selecting repositories.
- Never persist customer source. Store positions and names, read bodies live.
  Layer C relaxes this to *store a vector per symbol*; see its section.
- No new infrastructure. The existing Neon database holds the index.
- Degrade honestly: a missing or partial index is reported as such, never as
  "nothing references this".

## Non-goals

- A general knowledge graph (PRs, authors, review outcomes). That layer can
  hang off these node IDs later; it is not this spec.
- Semantic search before phase 5; and never as a substitute for resolution.
- Indexing pull request heads. The default branch only.
- Replacing `search_repository`. Text search stays; this adds resolution.

## Customer surface

1. Install the App, pick repositories. Nothing else.
2. Dashboard shows per repository: index status (`building` / `ready` /
   `failed` / `unsupported`), the SHA it covers, languages covered, and the
   resolution rate.
3. Nothing is written to the customer's repository. No branch, no workflow,
   no `contents: write`.

## Architecture

```
GitHub ──webhook──▶ receiver ──▶ index queue ──▶ indexer worker ──▶ Postgres
                        │                                               ▲
                        └──▶ review worker ──▶ tools ──query───────────┘
                                                 │
                                                 └──▶ agents
```

| Component | Responsibility |
|---|---|
| Receiver | Existing webhook endpoint. Enqueues index jobs; runs reviews. |
| Index queue | One job per `(repo, sha)`, deduplicated and debounced per repo. |
| Indexer worker | Ephemeral container. Clone → Layer A → Layer B → bulk-load Postgres → delete clone. |
| Postgres | The existing Neon database. The graph tables below plus one `repo_index` row per repository. |
| Review worker | Existing. Binds the four new tools; each one is a query. |

## Lifecycle

| Event | Action |
|---|---|
| `installation.created`, `installation_repositories.added` | Enqueue a full index for each repository. First review should already have it. |
| `push` to the default branch | Enqueue. Debounce: at most one build per repository per `INDEX_DEBOUNCE_SECONDS` (default 300); a newer push supersedes a queued one. |
| `repository.edited` (default branch changed) | Enqueue a full index. |
| `installation_repositories.removed`, `installation.deleted` | Delete the repository's index rows within 24h (cascade from `repo_index`). |
| Build failure | Row → `failed` with the reason; the previous index stays and remains served, flagged `stale`. Retry with backoff, max 3. |

Status transitions: `building → ready | failed | unsupported`. `unsupported`
means no language extractor matched anything; the row still records Layer A.

## Index content

### Layer A — the map

Built from the file tree and manifests. No parser, every repository gets it.

- **packages**: from `pnpm-workspace.yaml`, `package.json` workspaces,
  `go.work`/`go.mod`, `pyproject.toml`, `Cargo.toml`; each with `root`,
  `name`, `entry_points`, internal `depends_on`.
- **file roles**: `source | test | config | migration | generated | docs |
  vendored | asset`, from path conventions and manifests.
- **test ↔ source**: `foo.test.ts → foo.ts`, `tests/test_foo.py → foo.py`,
  `foo_test.go → foo.go`; recorded as `edges(kind = "tests")`.
- **ownership**: `CODEOWNERS` patterns resolved to paths.

### Layer B — the graph

[SCIP](https://github.com/sourcegraph/scip) indexers, one per language,
run in the container against the clone:

| Language | Indexer | Needs deps installed |
|---|---|---|
| TypeScript / JavaScript | `scip-typescript` | yes (`--ignore-scripts`) |
| Python | `scip-python` | yes |
| Go | `scip-go` | yes (module cache) |

Each indexer's output is converted to the schema below. A language with no
indexer contributes Layer A only and is listed in `coverage` as
`indexed = false`.

`resolution_rate` per language = resolved import edges ÷ import statements
seen. Reported to the agents on every tool result.

### Layer C — embeddings

One vector per symbol, for the two questions the graph cannot answer:
*is this pattern used elsewhere* and *where is the code for X*. Phase 5,
behind a per-team flag, because it changes the data promise.

- **Unit**: a symbol from Layer B — one function, class, or top-level const
  — never a file, never a fixed-size chunk. The text embedded is the
  symbol's source, capped at 2 000 tokens; longer bodies embed their first
  2 000.
- **Model**: the team's configured provider's embedding model; for the
  Anthropic path, Voyage's code model, since Anthropic ships none. Model
  name and dimension are recorded per build; a change re-embeds everything.
- **Storage**: `pgvector` on Neon (already available — no new
  infrastructure). `halfvec` at the model's native dimension.
- **Incremental by content hash**: `sha256(symbol source)` is stored beside
  the vector. On rebuild only symbols whose hash changed are re-embedded, so
  a push costs vectors proportional to the diff, not the repository. This is
  cheaper churn than `index_edges`.
- **What is stored**: the vector and the hash. Not the text. A vector is a
  lossy representation of the symbol's source, and it can be partially
  inverted; the security page must say "we store a numeric representation of
  each function's code", not "positions only", for teams with this on.
- **Scope**: every query is filtered by `index_id` *before* the vector
  distance, so a search never crosses tenants.

Coverage for Layer C is reported as `embedded / symbols` per language, the
same way `resolution_rate` is for Layer B.

### Schema (Postgres)

Drizzle tables in `@pr-review/db`, alongside the existing ones. A build writes
into a fresh `index_id`; `repo_index.current_index_id` flips only when the
build succeeds, and the previous index's rows are deleted afterwards. A review
never sees a half-built index.

```
repo_index
  repo_id            int  FK repos.id, PK
  current_index_id   int  FK index_builds.id, null until the first success
  status             enum building | ready | failed | unsupported
  default_branch     text
  failure_reason     text

index_builds
  id                 serial PK
  repo_id            int  FK repos.id
  sha                text
  schema_version     int
  coverage           jsonb    -- [{language, files, indexed, resolution_rate}]
  built_at           timestamptz
  build_ms           int

index_packages   (id, index_id FK, name, root, entry_points jsonb)
index_files      (id, index_id FK, path, package_id, role, language, loc, owners text[])
index_symbols    (id, index_id FK, file_id, name, kind, line, end_line, exported bool)
index_edges      (index_id FK, src int, dst int, kind, line)
index_embeddings (index_id FK, symbol_id FK, content_hash text, model text,
                  embedding halfvec(N))      -- Layer C only

indexes: index_files(index_id, path) unique
         index_symbols(index_id, file_id), index_symbols(index_id, name)
         index_edges(index_id, src, kind), index_edges(index_id, dst, kind)
         index_embeddings(index_id, content_hash)
         index_embeddings USING hnsw (embedding halfvec_cosine_ops)  -- Layer C only
```

`src` / `dst` are symbol IDs for `references` and `calls`, file IDs for
`imports` and `tests`; `kind` disambiguates. No source text anywhere.

Loads use `COPY`, not row inserts: a large repository is millions of edges.
Every query is scoped by `index_id`, which is the tenant boundary.

**When this outgrows one table.** `index_edges` for a very large monorepo is
tens of millions of rows and churns on every default-branch push. If that
becomes the storage or vacuum cost that matters, move `index_edges` (and only
that) to one blob per repository in object storage, keyed by `index_id`; the
schema is unchanged and the tools do not notice. Not before it hurts.

## Read path

At review start the worker:

1. Reads `repo_index` for the repository. No `current_index_id`, or a
   `schema_version` it does not know → tools are bound in **absent** mode.
2. Computes **stale paths**: files changed between the index's `sha` and the
   pull request's base SHA (compare API, capped at 300 files; beyond that
   every result is marked `stale: true`).

Each tool is one or two indexed queries scoped by `index_id`. Nothing is
downloaded; nothing is held in memory across a review.

Every tool result carries:

```json
{ "index": { "sha": "…", "age_hours": 3, "coverage": [...], "stale_paths": 2 } }
```

A path in the stale set is answered from the index but labelled `stale`.
A path added by the pull request has no node and says so.

## Tools

Added to `createReviewTools`; `find_importers` is removed once
`find_references` ships.

### `describe_area(path)`

Layer A only. Package, role, language, owners, tests covering it, sibling
files in the same directory (capped 30), and inbound/outbound import counts.
Works in every repository, including `unsupported`.

### `get_symbol(path, name)`

Definition location, kind, exported flag, and counts of inbound references by
kind. No body — the agent calls `get_file` for that.

### `find_references(path, name?)`

Without `name`: files importing `path` (resolved). With `name`: every
reference to that symbol, grouped by file, with line numbers. Capped at 50
files and 200 references; the result states `total` alongside what was
returned.

### `impact_of(path | symbol, depth = 2)`

Transitive dependents to `depth` (max 4), as `{path, via, distance}` rows
plus `total_dependents`, `total_files_reached`, and `tests_reached`. Depth
bounded and capped at 500 rows; the counts are always exact.

### `find_similar(path, start_line, end_line)` — Layer C

Embeds the given range of the pull request's HEAD file at review time and
returns the nearest symbols in the repository: `{path, name, kind, line,
similarity}`, capped at 20, with a similarity floor of 0.75. The range must
be in a changed file. The agent reads a hit's body with `get_file`. Intended
for "this same pattern exists elsewhere — is it wrong there too?"

### `search_semantic(query)` — Layer C

Natural-language query over the same vectors, capped at 20. Intended for
"where is the code that handles X?" when a name search would not find it.
Returns locations only.

Both report `embedded_symbols / total_symbols` so the agent knows what a
miss means.

### Absent mode

Every tool returns
`{ "index": { "status": "absent", "reason": "…" } }` and the agents fall
back to the existing tools. The prompt is told, once, that the index is not
available for this review.

### Opening message

The orchestrator adds one deterministic block per changed file, from Layer A
and inbound counts:

```
<repository_index sha="…" age_hours="3">
- packages/reviewer/src/memory.ts — @pr-review/reviewer, source, tested by memory.test.ts, 4 importers
- packages/ai/src/agents/tools.ts — @pr-review/ai, source, tested by tools.test.ts, 2 importers
</repository_index>
```

Absent: the block says so in one line.

## Security

- **Ephemeral container per job.** No shared filesystem, no network except
  GitHub and the package registries, killed at `INDEX_TIMEOUT_SECONDS`
  (default 900).
- **Dependency install runs with scripts disabled** (`pnpm install
  --ignore-scripts`, `pip install --no-build-isolation` where safe, Go module
  download only). A package that needs a build step resolves worse; the
  `resolution_rate` shows it.
- **Default branch only.** Never a pull request head, never a fork.
- **No source persisted.** The clone is deleted on exit; the index holds
  paths, names, kinds, and line numbers. Nothing else. This is the sentence
  on the security page.
- **Installation token scope**: `contents: read`, `metadata: read`. The
  index needs nothing the review does not already have.
- **Tenant isolation**: every query is scoped by `index_id`, which the
  review worker reads from its own repository's `repo_index` row. No query
  takes a path or name without that scope.
- **Untrusted input**: index rows are data the indexer wrote from customer
  code. Every string read from them is treated the same as a tool result
  today.
- **Layer C is opt-in per team** and sends symbol source to the embedding
  provider at index time and changed hunks at review time — the same
  provider the review already sends the diff to, so no new party sees the
  code. The stored vectors are the one thing in the index that is a
  representation of the code rather than a location in it.

## Limits

| Limit | Default | On breach |
|---|---|---|
| Repository size | 2 GB clone | `failed: too_large`; Layer A still attempted |
| Files | 200k | Layer B skipped; `unsupported` per language |
| Edges per index | 20M | build fails; raise the ceiling per plan |
| Build time | 15 min | killed; previous index kept |
| Builds per repo | 1 per 5 min, 1 in flight | queued builds collapse to the newest SHA |
| `impact_of` rows | 500 | counts stay exact |
| Embedded symbols per index | 1M | Layer C skipped; `embedded: false` |
| Embedding tokens per build | per plan | remaining symbols embed on the next build |

Per-plan overrides live on the team, not the repository.

## Failure modes

| Situation | Behaviour |
|---|---|
| Index building on the first PR | absent mode; the review runs on the eight existing tools |
| Build failed | previous index served as stale; dashboard shows the reason |
| Language not covered | Layer A answers; Layer B tools say `indexed: false` for it |
| Unknown `schema_version` | absent mode; rebuild enqueued |
| Database unreachable | absent mode; the review is never blocked on the index |

The index can make a review better. It must never make one fail.

## Rollout

1. **Layer A + `describe_area` + opening block.** No SCIP, no deps installed.
   Ships to every repository. Gate: `pnpm eval` shows no regression.
2. **`scip-typescript` → `find_references`, `get_symbol`.** Remove
   `find_importers`. Gate: eval findings improve on fixtures whose answers
   depend on cross-file resolution; if they do not, stop here.
3. **`impact_of`; Python and Go indexers.**
4. Dashboard: index status, coverage, "most-depended-on files" — all
   queries over tables that already exist by then.
5. **Layer C**: `find_similar`, `search_semantic`, per-team flag, security
   page updated. Gate: eval fixtures where the bug is a repeated pattern
   across files; if `find_similar` does not lift them, it stays off by
   default.

## Open questions

- Whether the self-hosted action gets any index at all, or it stays a
  hosted-only feature.
- Data residency for customers who ask; today the answer is "wherever Neon
  is".
- Layer C's embedding model per provider, and whether one model for every
  team (simpler, one vector space) beats the team's own provider (no new
  data-processor). Leaning one model for every team.
- Monorepos with several `tsconfig.json`: one `scip-typescript` run per
  project, or one at the root with `--infer-tsconfig`. Decide on the first
  real customer monorepo.
