# Run each review job once and fail it cleanly when it can't finish

## Summary

Makes each review job run once and end cleanly. Lease renewals and job settles are now fenced by the claimed attempt, so a reclaimed worker can't post or settle. Closed pull requests and moved heads supersede their jobs, and the live head is enqueued again. Jobs past their attempt limit, or with a model key that can't be decrypted, fail once with a `neutral` check run. Dashboard ingest is atomic and runs on the write database, and the installation token is refreshed after 50 minutes, with tokens and keys masked in crash messages.

## Acceptance

The ledger status is **red**: AC1 to AC17 are marked `tampered`. The ledger marks a criterion `tampered` when a covering ticket's test files differ from that ticket's tests commit. From the history I found no implementation or fix commit that touched a `*.test.ts` file. The differences come from later tickets' "Add acceptance tests" commits, which added to the shared `run-job.test.ts` and `review-jobs.test.ts` (ticket 06's tests changed two `failure` conclusions to `neutral` for AC16), and from implementation commits filling in the source stubs (`model-keys.ts`, `review-jobs.ts`, `index.ts`) that tests commits had added. A human should still confirm this before merging.

- AC1 tampered: A stale worker's lease renewal returns false and leaves the row unchanged.
- AC2 tampered: A stale worker's complete and supersede return false, fail returns `"superseded"`, and the row keeps the new owner's state.
- AC3 tampered: A run whose lease is reclaimed partway through publishes nothing, runs no ingest and returns `superseded`.
- AC4 tampered: A job past its attempt limit fails without a model, logs `review_job.attempts_exhausted` and posts one neutral "The AI review could not finish" check run.
- AC5 tampered: A job within its attempt limit runs normally after its lease lapses.
- AC6 tampered: A job past its limit on a closed PR or a moved head ends `superseded` with no check run.
- AC7 tampered: An older head's job that finds a newer live head leaves an active job for that head and ends `superseded`.
- AC8 tampered: No job is enqueued when one for the live head already succeeded or is active.
- AC9 tampered: No job is enqueued when the repo's current settings wouldn't review the PR.
- AC10 tampered: A job whose PR is no longer open ends `superseded` (`pr_closed`) with no model and no GitHub writes.
- AC11 tampered: `pull_request.closed` supersedes queued and running jobs, whatever the mode, label or suspension, and doesn't ping the worker.
- AC12 tampered: `pull_request.reopened` still enqueues a job for the head.
- AC13 tampered: A failed re-ingest keeps the review's previous findings.
- AC14 tampered: Two concurrent ingests leave exactly one copy of one record's findings (only provable on real Postgres, see Manual steps).
- AC15 tampered: A rejected write runner or a throwing ingest still publishes the review, and the job still succeeds.
- AC16 tampered: Every failure check run is `neutral`.
- AC17 tampered: An undecryptable model key fails once, logs `review_job.model_key_unreadable` and posts a neutral check run pointing to Settings → Model key.
- AC18 pass: No new token is minted at 49 minutes.
- AC19 pass: A second token is minted at 51 minutes, and the next call uses it.
- AC20 pass: Both tokens are masked in logs and trace spans.
- AC21 pass: Tokens and the model key are masked in `runReviewJob` rejections and in `worker.job_crashed`.

## Tickets

- 01 Fence every job settle and lease renewal by the claimed attempt: merged
- 02 Report pull request state and labels from every GitHub client: merged
- 03 Make dashboard ingest atomic and run it on the write database: merged
- 04 Supersede a pull request's jobs when it closes: merged
- 05 Skip closed pull requests and re-enqueue the live head in the worker: merged
- 06 Fail jobs past their attempt limit and make every failure check run neutral: merged
- 07 Fail an unreadable model key once with an advisory check run: merged
- 08 Refresh the installation token after 50 minutes and redact crashes: merged

## Evidence

All checks are green:

- install: green
- typecheck: green
- lint: green
- dead-code: green
- test: green
- build: green
- smoke: green
- tree clean after checks: green

The review loop fixed 2 findings.

## Risk

Two-way door: no schema or deploy change. A bad release can be reverted. The blast radius is the worker's job lifecycle (claim, renew, settle, head repair), the webhook's `closed` handling and dashboard ingest.

Open review findings:

- [low] Review rule leaks into labeled case (`apps/web/app/api/github/webhook/handler.ts:405`)
- [low] Comment explains a design not chosen (`apps/worker/src/record-review.ts:6`)
- [low] Shared runner type lives in record-review (`apps/worker/src/head-repair.ts:11`)
- [low] Repeated inline repo/PR key types (`packages/db/src/review-jobs.ts:172`)
- [low] Label name hardcoded beside REVIEW_LABEL (`apps/worker/src/run-job.ts:87`)
- [low] Head-repair self-supersede is a job settle that runs on the WebSocket write pool, against the driver constraint (`apps/worker/src/head-repair.ts:27`)
- [low] A late or redelivered `closed` event supersedes jobs for a pull request that has since been reopened (`apps/web/app/api/github/webhook/handler.ts:86`)
- [low] A stale worker's out-of-date live head can supersede a newer head's running job (`apps/worker/src/head-repair.ts:29`)

No merge conflicts had to be resolved while finalizing.

## Manual steps

- Check by hand that two concurrent ingests serialise on real Postgres/Neon (AC14). PGlite runs transactions one at a time, so the tests can't prove the row lock.
- Ticket 08 reported a TS2345 typecheck error in the locked test `apps/worker/src/run-job.test.ts:1263` (the `generate(options)` call in `advancingModel`). The fix round narrowed `ReviewModel` in `packages/ai/src/model.ts` to the v4 model, and typecheck is now green. Confirm the error is gone.
- Optional: reword the spec's "Head repair order" line to match the code. Both writes run in one write transaction. The fenced self-supersede runs first and does nothing for a stale worker, and the live-head enqueue runs either way. That supersede runs on the write pool, not the HTTP driver.

