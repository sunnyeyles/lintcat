# @pr-review/web

The public documentation at `/`, and the dashboard behind it: review history,
trends and token spend. Also
`POST /api/ingest`, where the action records each review, and
`POST /api/github/webhook`, where the GitHub App reports installations,
organization members and the pull requests to review in hosted mode.

The docs need no session; the dashboard starts at `/dashboard`, which every
page links to from the topbar.

```bash
pnpm --filter @pr-review/web dev     # http://localhost:3000
```

## Environment

| Variable                    | Used for                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`              | Postgres, see [`packages/db`](../../packages/db)                 |
| `AUTH_SECRET`               | Signs the session cookie; `pnpm dlx auth secret`                 |
| `AUTH_GITHUB_ID`            | The GitHub App's client id (user sign-in)                        |
| `AUTH_GITHUB_SECRET`        | The GitHub App's client secret                                   |
| `AUTH_TRUST_HOST`           | `true` for `next start` outside Vercel                           |
| `GITHUB_APP_ID`             | The GitHub App's id                                              |
| `GITHUB_APP_PRIVATE_KEY`    | The App's PEM key; newlines may be written as `\n`               |
| `GITHUB_APP_WEBHOOK_SECRET` | Verifies `X-Hub-Signature-256` on each delivery                  |
| `GITHUB_APP_SLUG`           | The App's URL slug; shows the Install button (optional)          |
| `APP_DOMAIN`                | Apex domain organizations are subdomains of; default `localhost` |
| `MODEL_KEY_ENCRYPTION_KEY`  | 32 bytes of base64 sealing model keys; `openssl rand -base64 32` |

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
organization's, is a 401 and writes nothing; a rerun of the same commit replaces that review's
findings.

The record may also carry the pull request's `baseSha`, its `changedFiles` and
a `graph`: the repository index serialised by `@pr-review/index`, gzipped and
base64 encoded, which is stored as those bytes under `(repo_id, base_sha)`. A
review whose index was off or failed simply sends no graph.

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
| `member`                    | `added`, `edited`, `removed`     | Same, when the repository belongs to an organization; then re-check that user's permission on the repo |
| `membership`                | `added`, `removed`               | Same                                                                           |
| `repository`                | `renamed`                        | Update the repo's owner and name                                               |
| `repository`                | `privatized`, `publicized`       | Flip `repos.private`; `privatized` also sets `repo_access` from the repo's collaborators |
| `repository`                | `deleted`, `transferred`         | Set `removed_at` (a transfer within the same account only updates owner/name)  |
| `pull_request`              | `labeled` with `ai-review`; `synchronize`, `reopened` on a PR carrying it | Queue a hosted review job; see Hosted reviews |

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

### Repository access

`repo_access` holds a user's GitHub permission (`admin`, `maintain`, `write`,
`triage`, `read`) on a repo. A member reads public repos, plus private ones they
have a row for; an organization owner reads every repo. A **repository owner** is
an organization owner, or `admin`/`maintain` on the repo. `lib/repo-access-sync.ts`
holds the lookups the webhook and sign-in share.

- A collaborator `member` event asks GitHub for that user's current permission
  (`GET /repos/{owner}/{repo}/collaborators/{username}/permission`), one call.
- `privatized` lists the repo's collaborators (`affiliation=all`, which covers
  teams and the organization's base role), one paginated call, and makes the
  repo's rows exactly that list. If GitHub fails the repo is still made private
  and existing rows stay.
- `repository` events carry no event time, so each action writes only its own
  field; a `privatized` and `publicized` delivered out of order can still
  settle on the older visibility.
- Leaving an organization deletes the user's rows on its repos.
- Team changes (`team_add`, team membership) are not subscribed, so they land
  with the user's next sign-in.
- Logged as `repo_access.granted`, `repo_access.revoked` or `repo_access.skipped`.

### Hosted reviews

A `pull_request` delivery only records a row in `review_jobs` and returns, well
inside GitHub's 10-second window; the review itself runs in
[`apps/worker`](../worker). A job is queued for `labeled` when the label is
`ai-review`, and for `synchronize` or `reopened` when the pull request already
carries it. Every other action, a closed pull request, and a repo that is
untracked, removed, or in a suspended or uninstalled organization get a 204 and
write nothing (`review_job.skipped`, with a `reason`).

- A redelivery carries the same `X-GitHub-Delivery`, which `review_jobs` keeps
  unique, and a unique index allows one queued or running job per pull request
  head. Either way the repeat is a 200 that writes nothing (`review_job.duplicate`).
- A new head supersedes the pull request's older queued or running jobs in the
  same transaction; the worker stops a superseded run before it publishes.

### Model key

An organization owner saves the provider and API key at `/o/<slug>/settings`
(`Settings` in the sidebar, shown to owners only; members get a 404). The key is
sealed with AES-256-GCM under `MODEL_KEY_ENCRYPTION_KEY`, bound to the
organization, and stored in `model_keys`; the page and the form's responses
carry only its last four characters. Replacing a key overwrites it, and removing
it deletes the row. The worker, which holds the same encryption key, is the only
reader of the plaintext. With no key saved, a labelled pull request gets a
neutral check run asking an owner to add one.

### Registering the App

- Permissions: repository **Metadata** (read), **Contents** (read),
  **Pull requests** (read and write) and **Checks** (read and write), organization
  **Members** (read), account **Email addresses** (read). The writes are the
  hosted review's check run and inline comments.
- Webhook URL `https://<app-domain>/api/github/webhook`, secret in
  `GITHUB_APP_WEBHOOK_SECRET`. Subscribe to `installation`,
  `installation_repositories`, `organization`, `member`, `membership`,
  `repository` and `pull_request`. Repository permissions need nothing beyond **Metadata**: both
  collaborator endpoints are listed under it with installation tokens.
- User authorization: callback URL as under Environment; its client id and
  secret are `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. There is no separate
  OAuth app.
- Setup URL `https://<app-domain>/dashboard/setup`, with **Redirect on update**
  ticked, so GitHub returns the installer to the dashboard (locally
  `http://lvh.me:3000/dashboard/setup`). The App's URL slug, from
  `github.com/apps/<slug>`, goes in `GITHUB_APP_SLUG`.
- Locally, forward deliveries to the dev server with a service such as smee.io.

## Sign-in

The GitHub App's user authorization through Auth.js v5 (`auth.ts`), with JWT
sessions and no auth tables; the GitHub provider works unchanged with an App's
client id and secret. The sign-in pass (`lib/sign-in.ts`) upserts the `users`
row by GitHub id, then refreshes the user's membership in every installed
organization. A user can have memberships in several organizations, each with
its own role; `/dashboard` lists them (`lib/organization.ts`), and forwards a
user with exactly one straight to it.

OAuth starts in one place: the topbar's **Sign in** links to
`/sign-in?callbackUrl=<the page>` on the apex, and only that page posts to
Auth.js. Auth.js sends its errors to the same page (`pages.error`), which
renders them through `lib/auth-errors.ts`. Sign-out returns to the apex
`/sign-in` from any host.

### Onboarding

A signed-in user with no organization sees **Install the GitHub App**, which
opens GitHub's install page. GitHub returns to
`/dashboard/setup?installation_id=…&setup_action=install`. That page fetches
the installation with the App's JWT and runs the same install path as the
webhook (`installOrganization` in `lib/installation.ts`), so it works before
the delivery arrives, and both paths converge whichever runs first. The user is
then forwarded to the organization, or to the picker if GitHub does not list
them as a member. `setup_action=request` (a non-admin asking an owner to
install) renders a note; a missing or malformed `installation_id` renders the
Install button again.

The refresh costs one `GET /orgs/{org}/memberships/{username}` per installed
organization, up to eight at a time, before one transaction writes the results.
Personal accounts need no call. Installation tokens are cached per process, so
a warm instance mints each one about once an hour. A failed lookup or a
suspended installation keeps what was stored, and a failed refresh never blocks
sign-in. The user's OAuth token is not kept.

Repository permissions are refreshed next, the same way: one
`GET /repos/{owner}/{repo}/collaborators/{username}/permission` per live private
repo in each installed, unsuspended organization where the user is a plain
member, up to eight at a time. Owners, public repos and personal accounts need
no call. A failed lookup keeps that repo's stored row.

## Organizations and access

Every organization page lives under `/o/<slug>/`. `authorize` (`packages/db/src/authorize.ts`)
reads only the database and returns the organization, the user's role and the
repos they may read (each with whether they own it), or not-found. Given a repo,
it also returns that repo. An unknown slug, a suspended or uninstalled
organization, a non-member and an unreadable or unknown repo get the same
not-found. `requireOrganization(slug)` in `lib/session.ts` is the guard
every organization layout and page calls: a signed-out visitor goes to
`/sign-in?callbackUrl=<the page>` (the path comes from `proxy.ts`), and a
not-found renders the 404.

## Subdomains

Each organization is also served at `<slug>.<APP_DOMAIN>`. `proxy.ts`
rewrites `acme.example.com/repos` onto `/o/acme/repos`; the mapping is
`organizationSlugFromHost` in `lib/host.ts`. The apex, the reserved names
`www app api auth admin docs status mail`, and every other host (Vercel preview
URLs included) pass through, so previews keep using `/o/` paths. `/api/*` and
`/_next/*` are never rewritten, and `/docs/*`, `/dashboard` and `/sign-in` are
redirected to the apex, since those pages exist only there (`isApexOnly` in `lib/paths.ts`;
the topbar links to them with `apexUrl`). Links inside an organization still use
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

The project's root directory is `apps/web`, so `apps/web/vercel.json` is the
one Vercel reads. Its `ignoreCommand` runs `turbo-ignore` for previews, which
skips the build when a push changed nothing this app depends on — most pushes
here touch the reviewer, the CLI or the action, and each one otherwise costs a
full deployment. Production builds always run.

### Deploys

Every branch other than `main` gets a preview from Vercel's Git integration,
as before. `main` does not: `git.deploymentEnabled` turns that off, and
`.github/workflows/production.yml` deploys instead, in order:

1. **CI** — `ci.yml`, called on the pushed commit.
2. **Migrate** — `db-migrate.yml` applies pending Drizzle migrations to
   `secrets.DATABASE_URL`; with none pending it is a no-op.
3. **Deploy** — `vercel deploy --prod` from the repo root, built by Vercel with
   the project's settings and Production environment variables.

A failed step stops the ones after it, so a commit whose CI failed never
migrates, and production never serves code whose migrations have not applied.
Vercel moves the production domains only once a build succeeds, so any failure
leaves the previous deployment live. Pipelines run one at a time; a push that
lands while one is queued replaces it, since the newer commit contains it.
Migrations still land before the new code serves, so each one must work with
the code already in production.

Repository secrets the pipeline needs (Settings > Secrets and variables >
Actions); it stops before CI if any Vercel one is missing:

| Secret              | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| `VERCEL_TOKEN`      | A Vercel access token scoped to the project's team           |
| `VERCEL_ORG_ID`     | `orgId` from `.vercel/project.json` after `vercel link`      |
| `VERCEL_PROJECT_ID` | `projectId` from the same file                               |
| `DATABASE_URL`      | The production Neon connection string (already used before)  |

To redeploy without a push, run the Production workflow from the Actions tab
on `main`; `db-migrate.yml` can also still be run by hand on its own.

A preview that fails within seconds of the push, with no preview URL, never
reached the build: look at the account rather than the diff. A pull request
from a fork fails the same way with "Authorization required to deploy" until
its author is authorized on the Vercel team.

## The seam

Pages never touch Drizzle. They ask for a `DataSource` (`packages/db/src/dashboard/types.ts`):

```ts
import { data } from "@/lib/data/server";

const reviews = await (await data(slug)).listReviews({ repoId, limit: 20 });
```

- `data(slug)` (`lib/data/server.ts`) is the organization `authorize` let the
  user into, read from Postgres by `createDbSource` in `packages/db/src/dashboard/source.ts`. Every
  query (lists, totals, trends, usage, a repo, a review and its siblings) is
  scoped through the review's repo to the repos `authorize` returned, so another
  organization's row, or a private repo the viewer cannot read, is a 404.
  Every page uses it.

Trends and usage are computed by the same functions in `packages/db/src/dashboard/aggregate.ts`
from the database rows.

## Cost figures

`packages/db/src/dashboard/aggregate.ts` holds a fixed per-million-token price table and derives
every dollar figure from the four token counters on `reviews`. The prices
are illustrative.

## Layout

```text
app/
  (docs)/page.tsx       the docs home, and the site's own homepage
  (docs)/docs/          one page per section; /docs redirects to the home
  (apex)/dashboard/     the signed-in user's organizations
  (apex)/dashboard/setup/  where GitHub returns after installing the App
  (apex)/sign-in/       sign-in and its errors, returning to callbackUrl
  o/[slug]/             one organization, guarded by requireOrganization
    page.tsx            overview
    repos/              repo list, and per-repo review history
    reviews/            recent reviews; [id]/ one review
    analytics/          trends over time
    usage/              tokens and spend
    settings/           the organization's model key, owners only
  api/ingest/           the action's endpoint
  api/github/webhook/   the GitHub App's webhook
components/
  ui/ shell/ charts/ overview/ review/ config/
  docs/                 the docs shell: nav, table of contents, prose
lib/
  data/                 the seam above
  docs.ts               the docs nav, its ordering and active-page rules
  authorize.ts          slug + session -> organization, role, readable repos, or not-found
  session.ts            session and the requireOrganization guard
  sign-in.ts            the sign-in pass: user row, then membership refresh
  membership-sync.ts    GitHub role -> membership, shared by webhook and sign-in
  repo-access-sync.ts   GitHub repo permission -> repo_access, same
  organization.ts       a user's memberships
  github-app.ts         the GitHub App's env and client
  model-key.ts          the model key form: owner check, validation, save and remove
  host.ts               request host -> organization slug, cookie domain
  paths.ts              /o/<slug> paths and callbackUrl checks
  format.ts             number, duration and date formatting
```
