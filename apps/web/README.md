# @pr-review/web

The dashboard: review history, trends, token spend, and an editor for
`.github/pr-review-agents.yml`. Also `POST /api/ingest`, where the action
records each review, and `POST /api/github/webhook`, where the GitHub App
reports installations and organization members.

```bash
pnpm --filter @pr-review/web dev     # http://localhost:3000
```

## Environment

| Variable                    | Used for                                               |
| --------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`              | Postgres, see [`packages/db`](../../packages/db)       |
| `AUTH_SECRET`               | Signs the session cookie; `pnpm dlx auth secret`       |
| `AUTH_GITHUB_ID`            | The GitHub App's client id (user sign-in)              |
| `AUTH_GITHUB_SECRET`        | The GitHub App's client secret                         |
| `AUTH_TRUST_HOST`           | `true` for `next start` outside Vercel                 |
| `GITHUB_APP_ID`             | The GitHub App's id                                    |
| `GITHUB_APP_PRIVATE_KEY`    | The App's PEM key; newlines may be written as `\n`     |
| `GITHUB_APP_WEBHOOK_SECRET` | Verifies `X-Hub-Signature-256` on each delivery        |

Locally they go in the repo root `.env.local` (gitignored); `.env.example`
lists them. Give the GitHub App the callback URL
`http://localhost:3000/api/auth/callback/github`, one more per deployed origin.
`next build` needs none of them: every page reads the session, so nothing is
prerendered.

## Ingest

`POST /api/ingest` takes a `reviewRecordSchema` body (`@pr-review/schemas`)
with `Authorization: Bearer <organization ingest secret>`. The organization's
row stores only the secret's SHA-256 (`hashIngestToken`). The record's owner
must be the organization's login, and the repo must not have been removed from
the installation, or it is a 404. A missing or unknown token, or an uninstalled
organization's, is a 401 and writes nothing; a rerun of the same commit replaces that review's agent
runs and findings.

## GitHub App webhook

`POST /api/github/webhook` turns GitHub App installations into organizations.
Each delivery's `X-Hub-Signature-256` is checked against
`GITHUB_APP_WEBHOOK_SECRET` before the body is parsed; a missing or wrong one is
a 401 and writes nothing.

| Event                       | Action                           | Effect                                                                         |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `installation`              | `created`                        | Upsert the organization; its live repos and members become what GitHub lists  |
| `installation`              | `suspend`, `unsuspend`           | Set or clear `organizations.suspended_at`; `unsuspend` re-lists the members    |
| `installation`              | `deleted`                        | Set `uninstalled_at` and clear `installation_id`; nothing is deleted          |
| `installation_repositories` | `added`, `removed`               | Upsert those repos (clearing `removed_at`), or set their `removed_at`          |
| `organization`              | `member_added`, `member_removed` | Re-check that user's membership with GitHub                                    |
| `member`                    | `added`, `edited`, `removed`     | Same, when the repository belongs to an organization                           |
| `membership`                | `added`, `removed`               | Same                                                                           |

Anything else gets a 204. The slug is the account's lowercased login; a
personal account becomes an organization of type `user`.

Uninstalling and removing repositories are soft: memberships, repos and reviews
stay, but an uninstalled organization is not-found to everyone, removed repos
and their reviews are left out of every page and total, and ingest for either is
rejected. Reinstalling (a `created` for the same account) clears
`uninstalled_at`, and the repos it lists come back with their history; ones it
does not list are marked removed. Only `created` revives an uninstalled
organization, so a late `installation_repositories` delivery cannot. Writes are
keyed on GitHub ids, so a redelivery converges, and each delivery's writes run
in one transaction over Neon's WebSocket pool (`withWriteDatabase`), since the
HTTP driver behind `db()` cannot run one. Pages keep reading over HTTP.

`created` lists the installation's repositories and members through
`GithubAppClient` (`@pr-review/github`), authenticated as the App with an
installation token; `unsuspend` re-lists the members. Tests pass a fake.

### Memberships

Roles come from GitHub and are never edited here: an organization admin is an
**owner**, any other member a **member**, and a personal account's own user its
owner. `lib/membership-sync.ts` holds the one set of sync functions the webhook
and sign-in share.

- Member events do not trust the payload's role. They ask GitHub for the user's
  current membership (`GET /orgs/{org}/memberships/{username}`) and store that,
  so reordered or redelivered events converge. GitHub has no webhook for a role
  change, so a promotion or demotion lands with that user's next member event or
  sign-in.
- An installation for an organization lists its members: two paginated calls,
  `role=admin` then `role=all`. Anyone stored who is no longer listed loses
  their membership.
- Events for an organization that is suspended or has not installed the App
  change nothing and get a 204.
- Every decision is logged: `membership.granted`, `membership.revoked` (with
  `removed`) or `membership.skipped`, each with a `reason` and `source`.

### Registering the App

- Permissions, all read-only: repository **Metadata**, organization
  **Members**, account **Email addresses**.
- Webhook URL `https://<app-domain>/api/github/webhook`, secret in
  `GITHUB_APP_WEBHOOK_SECRET`. Subscribe to `installation`,
  `installation_repositories`, `organization`, `member`, `membership` and
  `repository`. `repository` is not acted on yet and gets a 204.
- User authorization: callback URL as under Environment; its client id and
  secret are `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. There is no separate
  OAuth app.
- Locally, forward deliveries to the dev server with a service such as smee.io.

## Sign-in

The GitHub App's user authorization through Auth.js v5 (`auth.ts`), with JWT
sessions and no auth tables; the GitHub provider works unchanged with an App's
client id and secret. The sign-in pass (`lib/sign-in.ts`) upserts the `users`
row by GitHub id, then refreshes the user's membership in every installed
organization. A user can have memberships in several organizations, each with
its own role; `/` lists them (`lib/organization.ts`).

The refresh costs one `GET /orgs/{org}/memberships/{username}` per installed
organization, up to eight at a time, before one transaction writes the results.
Personal accounts need no call. Installation tokens are cached per process, so
a warm instance mints each one about once an hour. A failed lookup or a
suspended installation keeps what was stored, and a failed refresh never blocks
sign-in. The user's OAuth token is not kept.

## Organizations and access

Every organization page lives under `/o/<slug>/`. `authorize` (`lib/authorize.ts`)
reads only the database and returns the organization and the user's role, or
not-found. An unknown slug, a suspended or uninstalled organization and a
non-member get the same not-found. `requireOrganization(slug)` in `lib/session.ts` is the guard
every organization layout and page calls: a signed-out visitor goes to
`/sign-in?callbackUrl=<the page>` (the path comes from `middleware.ts`), and a
not-found renders the 404.

## The seam

Pages never touch Drizzle. They ask for a `DataSource` (`lib/data/types.ts`):

```ts
import { data } from "@/lib/data/server";

const reviews = await (await data(slug)).listReviews({ repoId, limit: 20 });
```

- `data(slug)` (`lib/data/server.ts`) is the organization `authorize` let the
  user into, read from Postgres by `createDbSource` in `lib/data/db.ts`. Every query is scoped
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
  (apex)/page.tsx       the signed-in user's organizations
  (apex)/sign-in/       sign-in, returning to callbackUrl
  o/[slug]/             one organization, guarded by requireOrganization
    page.tsx            overview
    repos/              repo list, and per-repo review history
    reviews/            recent reviews; [id]/ one review
    analytics/          trends over time (fixture)
    usage/              tokens and spend (fixture)
    settings/agents/    agent config editor (fixture)
  api/ingest/           the action's endpoint
  api/github/webhook/   the GitHub App's webhook
components/
  ui/ shell/ charts/ overview/ review/ config/
lib/
  data/                 the seam above
  authorize.ts          slug + session -> organization and role, or not-found
  session.ts            session and the requireOrganization guard
  sign-in.ts            the sign-in pass: user row, then membership refresh
  membership-sync.ts    GitHub role -> membership, shared by webhook and sign-in
  organization.ts       a user's memberships
  github-app.ts         the GitHub App's env and client
  paths.ts              /o/<slug> paths and callbackUrl checks
  format.ts             number, duration and date formatting
  agent-config.ts       pr-review-agents.yml serialisation
```
