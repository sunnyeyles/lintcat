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
- Degrade honestly: a missing or partial index is reported as such, never as
  "nothing references this".

## Non-goals

- A general knowledge graph (PRs, authors, review outcomes). That layer can
  hang off these node IDs later; it is not this spec.
- Semantic or embedding search.
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
GitHub ──webhook──▶ receiver ──▶ index queue ──▶ indexer worker
                        │                             │
                        │                             ├─▶ object storage  (graph.sqlite per repo)
                        │                             └─▶ Postgres        (repo_index row)
                        │
                        └──▶ review worker ──▶ fetch graph.sqlite ──▶ tools ──▶ agents
```

| Component | Responsibility |
|---|---|
| Receiver | Existing webhook endpoint. Enqueues index jobs; runs reviews. |
| Index queue | One job per `(repo, sha)`, deduplicated and debounced per repo. |
| Indexer worker | Ephemeral container. Clone → Layer A → Layer B → write blob → delete clone. |
| Object storage | S3/R2. One `graph.sqlite` per repository, overwritten per successful build. |
| Postgres | `repo_index` rows: status, sha, coverage, timings. Never the graph itself. |
| Review worker | Existing. Fetches the blob at review start and binds the four new tools. |

## Lifecycle

| Event | Action |
|---|---|
| `installation.created`, `installation_repositories.added` | Enqueue a full index for each repository. First review should already have it. |
| `push` to the default branch | Enqueue. Debounce: at most one build per repository per `INDEX_DEBOUNCE_SECONDS` (default 300); a newer push supersedes a queued one. |
| `repository.edited` (default branch changed) | Enqueue a full index. |
| `installation_repositories.removed`, `installation.deleted` | Delete the blob and the `repo_index` row within 24h. |
| Build failure | Row → `failed` with the reason; the previous blob stays and remains served, flagged `stale`. Retry with backoff, max 3. |

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

### Schema (`graph.sqlite`)

```sql
CREATE TABLE meta      (key TEXT PRIMARY KEY, value TEXT);          -- sha, built_at, schema_version
CREATE TABLE packages  (id INTEGER PRIMARY KEY, name TEXT, root TEXT, entry_points TEXT);
CREATE TABLE files     (id INTEGER PRIMARY KEY, path TEXT UNIQUE, package_id INTEGER,
                        role TEXT, language TEXT, loc INTEGER, owners TEXT);
CREATE TABLE symbols   (id INTEGER PRIMARY KEY, file_id INTEGER, name TEXT, kind TEXT,
                        line INTEGER, end_line INTEGER, exported INTEGER);
CREATE TABLE edges     (src INTEGER, dst INTEGER, kind TEXT, line INTEGER);
CREATE TABLE coverage  (language TEXT PRIMARY KEY, files INTEGER, indexed INTEGER,
                        resolution_rate REAL);

CREATE INDEX symbols_file ON symbols(file_id);
CREATE INDEX symbols_name ON symbols(name);
CREATE INDEX edges_src    ON edges(src, kind);
CREATE INDEX edges_dst    ON edges(dst, kind);
```

`edges.src` / `edges.dst` are symbol IDs for `references` and `calls`, file IDs
for `imports` and `tests`; `kind` disambiguates. No source text anywhere.

`schema_version` is bumped on any incompatible change; the review worker
refuses a blob whose version it does not know and treats it as missing.

### Postgres

```
repo_index
  repo_id           int  FK repos.id, PK
  status            enum building | ready | failed | unsupported
  sha               text     -- commit indexed
  default_branch    text
  blob_key          text     -- object storage key
  blob_bytes        int
  schema_version    int
  coverage          jsonb    -- [{language, files, indexed, resolution_rate}]
  built_at          timestamptz
  build_ms          int
  failure_reason    text
```

## Read path

At review start the worker:

1. Reads `repo_index` for the repository. Missing, `building` with no prior
   blob, or unknown `schema_version` → tools are bound in **absent** mode.
2. Fetches `graph.sqlite` from object storage; opens it read-only with
   `node:sqlite`.
3. Computes **stale paths**: files changed between `meta.sha` and the pull
   request's base SHA (compare API, capped at 300 files; beyond that every
   result is marked `stale: true`).

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
- **No source persisted.** The clone is deleted on exit; the blob holds
  paths, names, kinds, and line numbers. Nothing else. This is the sentence
  on the security page.
- **Installation token scope**: `contents: read`, `metadata: read`. The
  index needs nothing the review does not already have.
- **Tenant isolation**: blob keys are `{installation_id}/{repo_id}/graph.sqlite`;
  the review worker only ever reads the key from its own `repo_index` row.
- **Untrusted input**: the blob is data the indexer wrote from customer code.
  Every string read from it is treated the same as a tool result today.

## Limits

| Limit | Default | On breach |
|---|---|---|
| Repository size | 2 GB clone | `failed: too_large`; Layer A still attempted |
| Files | 200k | Layer B skipped; `unsupported` per language |
| Blob size | 250 MB | build fails; raise the ceiling per plan |
| Build time | 15 min | killed; previous blob kept |
| Builds per repo | 1 per 5 min, 1 in flight | queued builds collapse to the newest SHA |
| `impact_of` rows | 500 | counts stay exact |

Per-plan overrides live on the team, not the repository.

## Failure modes

| Situation | Behaviour |
|---|---|
| Index building on the first PR | absent mode; the review runs on the eight existing tools |
| Build failed | previous blob served as stale; dashboard shows the reason |
| Language not covered | Layer A answers; Layer B tools say `indexed: false` for it |
| Blob corrupt / wrong version | absent mode; alert; rebuild enqueued |
| Object storage down | absent mode; the review is never blocked on the index |

The index can make a review better. It must never make one fail.

## Rollout

1. **Layer A + `describe_area` + opening block.** No SCIP, no deps installed.
   Ships to every repository. Gate: `pnpm eval` shows no regression.
2. **`scip-typescript` → `find_references`, `get_symbol`.** Remove
   `find_importers`. Gate: eval findings improve on fixtures whose answers
   depend on cross-file resolution; if they do not, stop here.
3. **`impact_of`; Python and Go indexers.**
4. Dashboard: index status, coverage, "most-depended-on files" if wanted
   (would need edges mirrored to Postgres; not before there is a use).

## Open questions

- Object storage provider and region policy for customers who ask.
- Whether the self-hosted action gets a read-only path to a customer-supplied
  blob, or stays without an index entirely.
- Monorepos with several `tsconfig.json`: one `scip-typescript` run per
  project, or one at the root with `--infer-tsconfig`. Decide on the first
  real customer monorepo.
