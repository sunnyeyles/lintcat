# @pr-review/db

Postgres on Neon, accessed through Drizzle. `db()` returns the client; the
tables are exported from `src/schema.ts`.

```mermaid
erDiagram
  teams |o--o{ users : "has"
  teams ||--o{ repos : "owns"
  repos ||--o{ reviews : "collects"
  reviews ||--o{ findings : "holds"
  reviews ||--o{ agent_runs : "times"
  repos ||--o| repo_index : "indexed by"
  repos ||--o{ index_builds : "built"
  index_builds ||--o| repo_index : "served as current"
  index_builds ||--o{ index_packages : "groups"
  index_builds ||--o{ index_files : "lists"
  index_files ||--o{ index_symbols : "declares"
  index_builds ||--o{ index_edges : "links"

  users {
    serial id PK
    int github_id UK
    text login
    text name
    text email
    text avatar_url
    int team_id FK
    role role "owner admin member"
  }
  teams {
    serial id PK
    text slug UK "subdomain"
    text name
    text github_org
  }
  repos {
    serial id PK
    int team_id FK
    text owner
    text name
  }
  reviews {
    serial id PK
    int repo_id FK
    int pr_number
    text head_sha
    text[] agents
    text summary
    int duration_ms
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
    text file
    int line
    text category
    severity severity "low medium high"
    text title
    text explanation
    text suggested_fix
    real confidence
  }
  repo_index {
    int repo_id PK
    int current_index_id FK
    index_status status "building ready failed unsupported"
    text default_branch
    text failure_reason
  }
  index_builds {
    serial id PK
    int repo_id FK
    text sha
    int schema_version
    jsonb coverage
    int build_ms
  }
  index_packages {
    serial id PK
    int index_id FK
    text name
    text root
    text[] entry_points
    text[] depends_on
  }
  index_files {
    serial id PK
    int index_id FK
    text path UK "unique per index_id"
    int package_id FK
    text role "source test config ..."
    text language
    int loc
    text[] owners
  }
  index_symbols {
    serial id PK
    int index_id FK
    int file_id FK
    text name
    text kind
    int line
    int end_line
    bool exported
  }
  index_edges {
    int index_id FK
    int src
    int dst
    text kind
    int line
  }
```

- `teams.slug` is the subdomain: `acme` → `acme.<app-domain>`.
- `agent_runs` is one row per agent per review, carrying the four token counters
  the logging events already emit. Nothing writes it yet — see the dashboard's
  `lib/data/`.
- One team per user: `users.team_id`, null until they create or join one.
  Many teams per user later means moving that column into a join table.
- Deleting a team cascades to its repos, reviews and findings; its users stay
  and get `team_id = null`.
- The repository index (`docs/specs/repo-index.md`) lives under one
  `index_builds` row per build; every index table is scoped by `index_id`,
  which is the tenant boundary.
- `src/index-store.ts` writes it: one transaction inserts the build, flips
  `repo_index.current_index_id` to it and deletes the repository's older
  builds, so a review never reads a half-built index. That needs a driver with
  real transactions; `db()` over neon-http has none.
- `index_edges.src`/`dst` are file ids for `imports` and `tests`, symbol ids
  otherwise; `kind` says which. No source text is stored anywhere.
- `index_symbols` is Layer B: created with the rest so the migration is one
  step, empty until the SCIP indexers land.

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
