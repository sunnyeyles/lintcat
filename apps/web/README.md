# @pr-review/web

The dashboard: review history, trends, token spend, and an editor for
`.github/pr-review-agents.yml`. Also `POST /api/ingest`, where the action
records each review.

```bash
pnpm --filter @pr-review/web dev     # http://localhost:3000
```

## Environment

| Variable             | Used for                                               |
| -------------------- | ------------------------------------------------------ |
| `DATABASE_URL`       | Postgres, see [`packages/db`](../../packages/db)       |
| `AUTH_SECRET`        | Signs the session cookie; `pnpm dlx auth secret`       |
| `AUTH_GITHUB_ID`     | GitHub OAuth app client id                             |
| `AUTH_GITHUB_SECRET` | GitHub OAuth app client secret                         |
| `AUTH_TRUST_HOST`    | `true` for `next start` outside Vercel                 |

Locally they go in the repo root `.env.local` (gitignored); `.env.example`
lists them. Register the OAuth app with the callback URL
`http://localhost:3000/api/auth/callback/github`, one more per deployed origin.
`next build` needs none of them: every page reads the session, so nothing is
prerendered.

## Ingest

`POST /api/ingest` takes a `reviewRecordSchema` body (`@pr-review/schemas`)
with `Authorization: Bearer <organization ingest secret>`. The organization's
row stores only the secret's SHA-256 (`hashIngestToken`). The record's owner
must be the organization's login, or it is a 404. A missing or unknown token is a 401
and writes nothing; a rerun of the same commit replaces that review's agent
runs and findings.

## Sign-in

GitHub OAuth through Auth.js v5 (`auth.ts`), with JWT sessions and no auth
tables. The sign-in pass upserts the `users` row by GitHub id. A user can have
memberships in several organizations (`lib/organization.ts`); the pages show the
oldest one. `requireMembership()` in `lib/session.ts` sends anyone signed out or
without a membership to `/sign-in`.

## The seam

Pages never touch Drizzle. They ask for a `DataSource` (`lib/data/types.ts`):

```ts
import { data } from "@/lib/data/server";

const reviews = await (await data()).listReviews({ repoId, limit: 20 });
```

- `data()` (`lib/data/server.ts`) is the signed-in user's organization, read
  from Postgres by `createDbSource` in `lib/data/db.ts`. Every query is scoped
  by the organization through the review's repo, so another organization's row
  is a 404, not a leak.
  Overview, Repositories, a repository, and the review pages use it.
- `demoData()` (`lib/data/index.ts`) is the seeded fixture in `lib/data/mock.ts`.
  Analytics, Usage and Agents still use it, and show a **DEMO DATA** chip.

Trends and usage are computed by the same functions in `lib/data/aggregate.ts`
for both sources. Agents the UI has no colour for (such as `general`) are left
out of agent chips and run strips; their tokens still count toward cost.

## Cost figures

`lib/data/aggregate.ts` holds a fixed per-million-token price table and derives
every dollar figure from the four token counters in `agent_runs`. The prices
are illustrative.

## Layout

```text
app/
  page.tsx              overview
  repos/                repo list, and per-repo review history
  reviews/              recent reviews; [id]/ one review
  analytics/            trends over time (fixture)
  usage/                tokens and spend (fixture)
  settings/agents/      agent config editor (fixture)
  sign-in/              sign-in and no-organization state
  api/ingest/           the action's endpoint
components/
  ui/ shell/ charts/ overview/ review/ config/
lib/
  data/                 the seam above
  session.ts            session and membership helpers
  organization.ts       a user's memberships
  format.ts             number, duration and date formatting
  agent-config.ts       pr-review-agents.yml serialisation
```
