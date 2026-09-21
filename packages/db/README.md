# @pr-review/db

Postgres on Neon, accessed through Drizzle. `db()` returns the client; the
tables are exported from `src/schema.ts`.

```mermaid
erDiagram
  organizations ||--o{ memberships : "has"
  users ||--o{ memberships : "holds"
  organizations ||--o{ repos : "owns"
  users ||--o{ repo_access : "holds"
  repos ||--o{ repo_access : "grants"
  repos ||--o{ reviews : "collects"
  repos ||--o{ repository_graphs : "snapshots"
  reviews ||--o{ findings : "holds"
  reviews ||--o{ agent_runs : "times"

  users {
    serial id PK
    bigint github_id UK
    text login
    text name
    text email
    text avatar_url
  }
  organizations {
    serial id PK
    bigint github_account_id UK
    account_type account_type "organization user"
    text slug UK "lowercased login, subdomain"
    text name
    bigint installation_id UK
    timestamptz suspended_at
    timestamptz uninstalled_at
    text ingest_token UK "sha-256 hex"
  }
  memberships {
    serial id PK
    int user_id FK
    int organization_id FK
    membership_role role "owner member"
    timestamptz synced_at
  }
  repos {
    serial id PK
    int organization_id FK
    bigint github_repo_id UK "null until the App reports it"
    text owner
    text name
    boolean private
    timestamptz removed_at
  }
  repo_access {
    serial id PK
    int user_id FK
    int repo_id FK
    repo_permission permission "admin maintain write triage read"
    timestamptz synced_at
  }
  reviews {
    serial id PK
    int repo_id FK
    int pr_number
    text head_sha
    text base_sha "the graph this review reads"
    jsonb changed_files "path status additions deletions"
    text[] agents
    text summary
    int duration_ms
  }
  repository_graphs {
    serial id PK
    int repo_id FK
    text base_sha
    bytea snapshot "gzipped JSON of the index"
    int file_count
    int edge_count
    timestamptz created_at
  }
  agent_runs {
    serial id PK
    int review_id FK
    text agent
    int duration_ms
    int finding_count
    int input_tokens
    int cache_creation_input_tokens
    int cache_read_input_tokens
    int output_tokens
  }
  findings {
    serial id PK
    int review_id FK
    text agent
    text file
    int line
    text category
    severity severity "low medium high"
    text title
    text explanation
    text suggested_fix
    real confidence
  }
```

- An organization is one GitHub account, an organization or a user.
  `github_account_id` is the durable key; `slug` is the lowercased login and the
  subdomain: `acme` → `acme.<app-domain>`.
- `agent_runs` is one row per agent per review, carrying the four token counters
  the logging events already emit. `ingestReviewRecord` writes it from the
  record's `agentRuns`.
- `organizations.ingest_token` holds the SHA-256 hex of the ingest secret, never
  the secret. `hashIngestToken` in `src/ingest.ts` computes it.
- `reviews (repo_id, pr_number, head_sha)` is unique: the ingest upsert's
  conflict target, so a rerun of one commit replaces its runs and findings.
- `findings.agent` records which review agent produced the finding; `category`
  stays the finding's own classification.
- `repository_graphs` is the repository index serialised by `@pr-review/index`,
  gzipped by the reviewer and stored as those exact bytes: ingest only base64
  decodes them, and the web data layer gunzips on read. It is unique on
  `(repo_id, base_sha)`, so every review of one base shares a row, and ingest
  keeps the newest `REPOSITORY_GRAPH_RETENTION` (20) per repo, deleting the
  rest (`src/repository-graphs.ts`). A review whose index was off or failed
  records `base_sha` and `changed_files` and no snapshot.
- `memberships` is unique on `(user_id, organization_id)`: one role per user
  per organization, and a user may belong to any number of organizations.
- `repo_access` is a user's GitHub permission on one repo, unique on
  `(user_id, repo_id)`. A member reads a public repo without a row and a
  private one only with a row; organization owners read every repo
  (`src/repo-access.ts`).
- `repos.github_repo_id` is the key the installation webhook upserts on
  (`src/installations.ts`); a repo ingest recorded first is claimed by owner
  and name, so its reviews stay.
- Uninstalling sets `organizations.uninstalled_at` and removing a repository
  sets `repos.removed_at`; neither deletes a row, so reviews survive a
  reinstall. A hard delete of an organization still cascades to everything
  under it.

## Commands

```bash
pnpm db:generate   # write a migration from schema changes
pnpm db:push       # apply the schema straight to DATABASE_URL (dev)
pnpm db:migrate    # apply pending migrations
pnpm db:studio     # browse the data
```

`DATABASE_URL` comes from Vercel in production and from the nearest
`.env.local` locally.

`.github/workflows/db-migrate.yml` runs `db:migrate` against `secrets.DATABASE_URL`
when a merge to `main` adds anything under `drizzle/`; it can also be run by hand.

## Tests

```ts
import { createTestDatabase } from "@pr-review/db/test-database";

const database = await createTestDatabase();
```

An in-memory Postgres (PGlite) with `drizzle/` applied, so tests need no
`DATABASE_URL`. `Database` is driver-agnostic, so anything typed against it
takes the test client as readily as the Neon one.

`ingestReviewRecord` runs its writes one by one: the Neon HTTP driver behind
`db()` has no interactive transactions. Writes that must be atomic go through
`withWriteDatabase(run)`, a Neon WebSocket pool opened for `run` and closed
after; `.transaction()` works there and on the test database.
