# @pr-review/worker

Runs hosted reviews: the ones the GitHub App triggers, with no workflow in the
repository.

The App's `pull_request` webhook (`apps/web/app/api/github/webhook`) records a
row in `review_jobs` and returns. This worker claims those rows and runs the
same review the MCP server runs, publishing the `AI PR Review`
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
| `REVIEW_INCREMENTAL` | Optional. `false` makes every review read the whole pull request; by default a push is reviewed from the last reviewed commit on |
| `PORT` | Switches to server mode and sets its listen port; set by Cloud Run |
| `WORKER_PING_SECRET` | Server mode only. Bearer token an inbound request must carry; shared with `apps/web`'s `WORKER_URL`/`WORKER_PING_SECRET` |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Optional. Sends each job's trace to Langfuse (see Tracing, below); off unless both are set |
| `LANGFUSE_ENVIRONMENT` | Optional. Tags traces, e.g. `production`; `LANGFUSE_BASE_URL` defaults to Langfuse Cloud EU |

## What one job does

1. Claims the oldest due job with `FOR UPDATE SKIP LOCKED`, so any number of
   workers can run side by side without sharing a job. The claim takes a
   five-minute lease, renewed every 15 seconds while the job runs; a job whose
   worker died is claimable again once its lease lapses.
2. Mints a fresh installation token. It lives in memory for this job only and
   is never written anywhere.
3. Checks the pull request on GitHub. If it is closed, the job is superseded
   and nothing is published. If its head has moved past the job's commit, the
   job is superseded, a job for the live head is queued unless one already
   ran or is active, and nothing is published.
4. Checks the attempt limit. A claim past the last allowed attempt means every
   earlier run stopped without settling (its worker crashed and the lease
   lapsed), so the job fails with no model called, logs
   `review_job.attempts_exhausted`, and publishes a neutral check run saying
   the review stopped without finishing on every attempt.
5. Opens the organization's model key. With no key saved, it publishes a
   neutral check run asking an owner to add one, and calls no model.
6. Reads the repo's settings. The model is the repo's choice or the key's
   provider default; a model the provider does not offer fails the job at once,
   with no retry, and a neutral check run naming it.
7. Runs `runReview` from `@pr-review/reviewer` with the GitHub delivery. With
   the repo's fixes on, verified patches are committed to the head branch under
   the same limits, unless the head commit is our own fix; otherwise they arrive as suggested changes.
8. Writes the review straight to the database through ingest's write path, so a
   rerun of the same commit replaces its findings and its blast radius (risk
   score and band, factors, and dependent file paths and counts; never source
   text). A record the schema rejects is logged as `review_job.record_invalid`
   with the failing field paths and not stored. A failure here is logged and
   never fails a review already on GitHub.

## Superseding

A push to a pull request queues a new job and marks the older one superseded,
queued or running. The running worker notices at its next lease renewal and
aborts the review; every publish also re-checks the row first, so a superseded
run publishes nothing even if it finished.

## Retries

A failed job is requeued a minute later, up to three attempts in all. The last
failure publishes a check run saying the review gave up. Every check run the
worker publishes is `neutral`: the review is advisory and never blocks a merge.
A job whose worker crashes is reclaimed once its lease lapses, and counts an
attempt each time, so a job that crashes on every attempt stops at the limit
(step 4) rather than being reclaimed forever. Every settle is fenced by the
claimed attempt, so a stale worker publishes nothing. Errors are
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

### Tracing

Each job's trace (model calls, tool calls with their results, pipeline stages)
goes to Langfuse Cloud EU. The job's installation token and model key, and
known credential formats anywhere in a trace, are masked before export
(`packages/ai/src/scrub-spans.ts`). The public docs promise EU hosting, masking
and 30-day deletion, so all three must hold before the keys are attached:

1. Create a Langfuse Cloud **EU** organization with a `prod` and a `dev`
   project. Set each project's data retention to 30 days, and sign Langfuse's
   DPA.
2. Put the `prod` secret key in Secret Manager and attach both keys to the
   service:
   `gcloud run services update <service> --region=<region>
   --update-secrets=LANGFUSE_SECRET_KEY=LANGFUSE_SECRET_KEY:latest
   --update-env-vars=LANGFUSE_PUBLIC_KEY=<pk-lf-…>,LANGFUSE_ENVIRONMENT=production`.
   Like the other secrets, the deploy workflow leaves them untouched.
3. Use the `dev` keys in `.env.local` for local runs and `pnpm eval`.

Removing the two variables (`--remove-env-vars`, `--remove-secrets`) turns
tracing off again.
