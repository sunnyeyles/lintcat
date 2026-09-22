# @pr-review/worker

Runs hosted reviews: the ones the GitHub App triggers, with no workflow in the
repository.

The App's `pull_request` webhook (`apps/web/app/api/github/webhook`) records a
row in `review_jobs` and returns. This worker claims those rows and runs the
same review the Action and the MCP server run, publishing the `AI PR Review`
check run and inline comments through the App's installation.

## Run it

```bash
pnpm --filter @pr-review/worker start           # poll forever
pnpm --filter @pr-review/worker start -- --once # drain the queue, then exit
```

`start` bundles `src/index.ts` with esbuild and runs it. It reads the nearest
`.env.local` up the tree; variables already in the environment win.

Setting `PORT` switches the same entrypoint into server mode instead: it
listens for HTTP requests rather than polling (see Deploy, below). Leave
`PORT` unset for the two commands above, including in production off Cloud
Run — nothing here changes them.

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | The Neon database the webhook writes jobs to |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | Minting an installation token for each job |
| `MODEL_KEY_ENCRYPTION_KEY` | Opening the organization's model key; must match the dashboard's |
| `APP_DOMAIN` | Optional. Links the "add a model key" check run to `https://<slug>.<APP_DOMAIN>/settings` |
| `WORKER_POLL_MS` | Optional. How often an idle worker checks for work; 5000 by default |
| `PORT` | Switches to server mode and sets its listen port; set by Cloud Run |
| `WORKER_PING_SECRET` | Server mode only. Bearer token an inbound request must carry; shared with `apps/web`'s `WORKER_URL`/`WORKER_PING_SECRET` |

## What one job does

1. Claims the oldest due job with `FOR UPDATE SKIP LOCKED`, so any number of
   workers can run side by side without sharing a job. The claim takes a
   five-minute lease, renewed every 15 seconds while the job runs; a job whose
   worker died is claimable again once its lease lapses.
2. Mints a fresh installation token. It lives in memory for this job only and
   is never written anywhere.
3. Checks the pull request's head on GitHub. If it has moved past the job's
   commit, the job is superseded and nothing is published.
4. Opens the organization's model key. With no key saved, it publishes a
   neutral check run asking an owner to add one, and calls no model.
5. Reads the repo's settings. The model is the repo's choice or the key's
   provider default; a model the provider does not offer fails the job at once,
   with no retry, and a `failure` check run naming it.
6. Runs `runReview` from `@pr-review/reviewer` with the GitHub delivery. With
   the repo's fixes on, verified patches are committed to the head branch under
   the Action's limits; otherwise they arrive as suggested changes.
7. Writes the review straight to the database through ingest's write path, so a
   rerun of the same commit replaces its findings. A failure here is logged and
   never fails a review already on GitHub.

## Superseding

A push to a pull request queues a new job and marks the older one superseded,
queued or running. The running worker notices at its next lease renewal and
aborts the review; every publish also re-checks the row first, so a superseded
run publishes nothing even if it finished.

## Retries

A failed job is requeued a minute later, up to three attempts in all. The last
failure publishes a `failure` check run saying the review gave up. Errors are
logged and stored with the model key and the installation token redacted.

## Deploy

Production runs one container, built by `Dockerfile` (build from the repo
root: `docker build -f apps/worker/Dockerfile .`) and deployed to Google Cloud
Run by `.github/workflows/production.yml`'s `deploy-worker` job, after
migrations, using Workload Identity Federation
(`google-github-actions/auth` + `deploy-cloudrun`) — no GCP key ever sits in
GitHub. The image is `dist/index.mjs`, esbuild's one self-contained bundle;
`@neondatabase/serverless` talks to Postgres over HTTP/WebSocket, so the image
needs nothing native.

With `PORT` set (Cloud Run always sets it), `src/index.ts` starts an HTTP
server instead of polling (`src/server.ts`). One endpoint, `POST /`, does
everything:

- Rejects anything without `Authorization: Bearer <WORKER_PING_SECRET>`, in
  constant time, with a 401 that runs nothing.
- Otherwise drains the queue once (claims and runs jobs until none are due)
  and answers `{ "processed": <count> }`. Concurrent requests share one
  in-flight drain rather than racing each other.

The same endpoint serves two callers, both carrying the same bearer token:

- `apps/web`'s webhook route, once per enqueued job (`WORKER_URL` +
  `WORKER_PING_SECRET` there) — fire-and-forget, so a slow or failed ping never
  slows or fails the webhook's own response.
- A Cloud Scheduler job hitting it every few minutes, the periodic sweep: it
  catches a job whose ping never arrived, and — since a claim also picks up
  any `running` job whose lease has lapsed (`packages/db/src/review-jobs.ts`)
  — a job whose worker died mid-run.

### One-time setup

Manual, done once per environment; nothing here is idempotent-by-CI.

**GitHub App** (`LintcatPR`) — see apps/web/README.md's
"Registering the App" for the full checklist. What's specific to hosted
reviews:

1. Widen the App's repository permissions to **Contents** (read and write),
   **Pull requests** (read and write) and **Checks** (read and write); it
   starts with only **Metadata**, **Members** and **Email addresses**, all read.
2. Subscribe the App to the `pull_request` event.
3. Every existing installation must accept the new permissions (GitHub prompts
   the installer; there's no API for this) before its pull requests can be
   reviewed.

**Vercel** (`apps/web`), if not already done for this project:

1. A wildcard domain `*.<app-domain>` on the production project — needs the
   project's nameservers pointed at Vercel.
2. The App's environment variables (`GITHUB_APP_*`, `AUTH_GITHUB_*`) on the
   production environment.

**Google Cloud**, once per GCP project:

1. Enable the Cloud Run, Artifact Registry and Cloud Scheduler APIs.
2. An Artifact Registry Docker repository (`GCP_ARTIFACT_REPOSITORY`) in the
   deploy region.
3. A deploy service account with `roles/run.admin`,
   `roles/iam.serviceAccountUser` and `roles/artifactregistry.writer`, and a
   Workload Identity Federation pool + provider trusting this GitHub repo's
   OIDC tokens (`google-github-actions/auth`'s docs walk through both) —
   `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`.
4. Put `DATABASE_URL`, `GITHUB_APP_PRIVATE_KEY`, `MODEL_KEY_ENCRYPTION_KEY`
   and `WORKER_PING_SECRET` in Secret Manager. Never in the image, and never
   in the deploy workflow: they're attached to the Cloud Run service directly,
   and redeploys that only swap the image leave them untouched.
5. Create the Cloud Run service (`CLOUD_RUN_SERVICE`) once by hand — for
   example `gcloud run deploy <service> --image=<any placeholder> --region=<region>
   --allow-unauthenticated --set-env-vars=GITHUB_APP_ID=<id>,APP_DOMAIN=<domain>
   --set-secrets=DATABASE_URL=DATABASE_URL:latest,GITHUB_APP_PRIVATE_KEY=GITHUB_APP_PRIVATE_KEY:latest,MODEL_KEY_ENCRYPTION_KEY=MODEL_KEY_ENCRYPTION_KEY:latest,WORKER_PING_SECRET=WORKER_PING_SECRET:latest`
   — so a revision exists for the workflow to update; `--allow-unauthenticated`
   is correct here, since `WORKER_PING_SECRET` is the real gate, not Cloud
   Run's own IAM.
6. A Cloud Scheduler HTTP job targeting the service URL: `POST`, header
   `Authorization: Bearer <WORKER_PING_SECRET>`, a schedule of a few minutes
   (the periodic sweep above).
7. In this GitHub repo's Settings → Secrets and variables → Actions, set
   `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`,
   `GCP_REGION`, `GCP_ARTIFACT_REPOSITORY` and `CLOUD_RUN_SERVICE`. The
   production workflow's preflight job fails clearly if any is missing.
8. Set `WORKER_URL` (the Cloud Run service URL) and `WORKER_PING_SECRET` (the
   same value as step 4) on the Vercel production project, so `apps/web` can
   ping it.
