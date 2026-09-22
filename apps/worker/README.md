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

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | The Neon database the webhook writes jobs to |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | Minting an installation token for each job |
| `MODEL_KEY_ENCRYPTION_KEY` | Opening the organization's model key; must match the dashboard's |
| `APP_DOMAIN` | Optional. Links the "add a model key" check run to `https://<slug>.<APP_DOMAIN>/settings` |
| `WORKER_POLL_MS` | Optional. How often an idle worker checks for work; 5000 by default |

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

## Not here yet

Deploying to Cloud Run (#177).
