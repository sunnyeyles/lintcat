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
| `APP_DOMAIN`         | Apex domain organizations are subdomains of; default `localhost` |

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
memberships in several organizations, each with its own role; `/` lists them
(`lib/organization.ts`).

## Organizations and access

Every organization page lives under `/o/<slug>/`. `authorize` (`lib/authorize.ts`)
reads only the database and returns the organization and the user's role, or
not-found. An unknown slug, a suspended organization and a non-member get the
same not-found. `requireOrganization(slug)` in `lib/session.ts` is the guard
every organization layout and page calls: a signed-out visitor goes to
`/sign-in?callbackUrl=<the page>` (the path comes from `middleware.ts`), and a
not-found renders the 404.

## Subdomains

Each organization is also served at `<slug>.<APP_DOMAIN>`. `middleware.ts`
rewrites `acme.example.com/repos` onto `/o/acme/repos`; the mapping is
`organizationSlugFromHost` in `lib/host.ts`. The apex, the reserved names
`www app api auth admin docs status mail`, and every other host (Vercel preview
URLs included) pass through, so previews keep using `/o/` paths. `/api/*` and
`/_next/*` are never rewritten. Links inside an organization still use
`/o/<slug>/...`, and on a subdomain that form is served as is, so both work;
`acme.example.com/o/globex/...` is a 404.

Sign-in and the OAuth callback stay on the apex. The session cookie gets
`Domain=<APP_DOMAIN>`, so one sign-in covers every subdomain. A signed-out
visitor to `acme.example.com/usage` goes to
`https://example.com/sign-in?callbackUrl=https://acme.example.com/usage` and is
returned there; `safeCallbackUrl` accepts only paths and URLs on the app domain
or its subdomains.

Locally, `acme.localhost:3000` serves `acme`, but browsers do not share a
`localhost` cookie with its subdomains, so the cookie stays host-only and
sign-in returns to `/o/acme/...` on the apex instead. To exercise the shared
session, set `APP_DOMAIN=lvh.me` (public DNS pointing `*.lvh.me` at 127.0.0.1)
and use `http://lvh.me:3000` and `http://acme.lvh.me:3000`; register
`http://lvh.me:3000/api/auth/callback/github` on the OAuth app.

### Vercel

1. Move the domain's nameservers to Vercel (`ns1.vercel-dns.com`,
   `ns2.vercel-dns.com`); a wildcard domain needs them for its certificate.
2. Add both `example.com` and `*.example.com` to the project's domains.
3. Set `APP_DOMAIN=example.com` for Production only. Leave it unset for
   Preview: a browser rejects a `Domain=example.com` cookie on a `*.vercel.app`
   host, so sign-in there would never stick. Unset, the cookie is host-only.
4. The OAuth callback URL is registered once, on the apex:
   `https://example.com/api/auth/callback/github`.

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
components/
  ui/ shell/ charts/ overview/ review/ config/
lib/
  data/                 the seam above
  authorize.ts          slug + session -> organization and role, or not-found
  session.ts            session and the requireOrganization guard
  organization.ts       a user's memberships
  host.ts               request host -> organization slug, cookie domain
  paths.ts              /o/<slug> paths and callbackUrl checks
  format.ts             number, duration and date formatting
  agent-config.ts       pr-review-agents.yml serialisation
```
