# Spec: Run each review job exactly once, and fail it cleanly

**Feature:** job-once

**Ticket:** sunnyeyles/lintcat#286

## Problem

The hosted review queue can run one job twice. A worker whose lease lapses (a stalled or frozen Cloud Run instance) keeps renewing and can still complete or fail a job another worker has reclaimed, so the PR gets duplicate comments and check runs, the org's model key is charged twice, and a stale `failReviewJob` can requeue a run in progress. Around that: a job that crashes on every attempt is reclaimed forever; out-of-order pushes can leave the newest commit unreviewed; closed PRs still get reviewed; a failed ingest can leave a review with no findings; failure check runs are `failure`, breaking the "always advisory" rule; an unreadable stored key is retried as if transient; jobs over an hour lose their GitHub token; and crash logs bypass redaction.

## Outcome

A worker that has lost its lease posts nothing it has not already started posting. Every job ends in a final state with an advisory check run, reviews the PR's latest open head once, and records its findings atomically. Nothing the worker logs carries the job's token or key.

## Acceptance criteria

Fencing:

- AC1: Given a job claimed by worker A whose lease lapsed and was reclaimed by worker B, when A renews the lease, then the renewal returns false and the job's row is unchanged.
- AC2: Given the AC1 state, when A calls `completeReviewJob` or `supersedeReviewJob` they return false, and `failReviewJob` returns `"superseded"`; the row keeps B's status, lease and attempts.
- AC3: Given a running job whose lease renewal starts returning false mid-review because it was reclaimed, when the review reaches publishing, then nothing is posted to GitHub (no review, no comments, no check run, no fix commit), no dashboard ingest runs, and the run returns `superseded`.

Attempt limit:

- AC4: Given a job on an open PR whose live head is the job's head, whose lease lapsed on its final allowed attempt, when a worker claims it (so `attempts > maxAttempts`), then no model is created or called, the job ends `failed` with `lastError` "stopped without finishing on every attempt", event `review_job.attempts_exhausted` is logged, and one `neutral` check run titled "The AI review could not finish" is posted on its head, with a summary saying the review stopped without finishing on every attempt and to push a commit or re-add the `ai-review` label to try again.
- AC5: Given a job with `attempts <= maxAttempts`, when it is claimed after a lapsed lease, then it runs normally.
- AC6: Given a job with `attempts > maxAttempts` whose PR is closed or whose head moved, when it runs, then it ends `superseded` (per AC10 or AC7) and posts no check run.

Newest head wins:

- AC7: Given webhooks for head H2 (newer) then H1 (older) are enqueued in that order, so H1's job superseded H2's, when the worker runs H1's job and finds the PR's live head is H2, then an active job for H2 exists and H1's job ends `superseded`.
- AC8: Given a job finds the head moved and a job for (repo, PR, live head) has already succeeded or is active, when it supersedes itself, then no new job is enqueued.
- AC9: Given a job finds the head moved and the repo's current settings would not review that PR now (mode `off`, or label mode without the `ai-review` label), when it supersedes itself, then no new job is enqueued.

Closed PRs:

- AC10: Given a claimed job whose PR is not open by the time the worker fetches it, when the job runs, then it ends `superseded` with reason `pr_closed`, no model is created and nothing is posted to GitHub.
- AC11: Given a tracked repo's PR with a queued and a running job, when a `pull_request.closed` webhook (merged or not) arrives, then both jobs end `superseded`, regardless of the repo's mode, label or the org's suspension, and the worker is not pinged.
- AC12: Given a closed PR, when a `pull_request.reopened` webhook arrives, then a job is enqueued for its head as today.

Atomic ingest:

- AC13: Given a review already recorded with findings, when re-ingesting it fails after the old findings are deleted, then the review's previous findings are still stored.
- AC14: Given two ingests of the same review started together (`Promise.all`), when both finish, then the review holds exactly one copy of one record's findings.
- AC15: Given the write-database runner rejects or ingest throws during a hosted job, when the job finishes, then the GitHub review was still published and the job still succeeds.

Advisory failures:

- AC16: Given any job path that posts a check run (retries exhausted, unknown model, attempt limit, unreadable key, no key), then its conclusion is `neutral`.

Unreadable key:

- AC17: Given an org whose stored key can't be decrypted (wrong or rotated encryption key, or an unknown sealed format), when its job runs, then it ends `failed` on that attempt without retrying, logs `review_job.model_key_unreadable`, and posts a `neutral` check run telling an owner to re-add the key under Settings → Model key, with the settings link when one is configured.

Token and logs:

- AC18: Given a job whose token was minted 49 minutes ago (by the injected clock), when it makes a GitHub call, then no new token is minted.
- AC19: Given a job whose token was minted 51 minutes ago, when it makes the next GitHub call, then a second token is minted and that call uses it.
- AC20: Given both tokens from AC19, when an error containing either is logged or a trace span is scrubbed, then both are masked.
- AC21: Given a dependency used after the token is minted (for example `failReviewJob` or `createCheckRun`) rejects with a message containing the token or the model key, when `runReviewJob` rejects, then its error message has both masked, and so does the `worker.job_crashed` log.

## Behaviour details

- Fencing token is `attempts`. The claim already increments it; renew, complete, supersede and fail match on `id`, `status = 'running'` and the `attempts` value the worker claimed. Every settle in the job runner is fenced, including the not-installed path. A stale worker's heartbeat returns false, which aborts the run through the existing cancellation path.
- Fencing narrows the double-run window to a worker that freezes between its last renewal and a GitHub write it has already started; it does not close it.
- Order at job start: installation checks, mint token, fetch the PR, closed check (AC10), head check (AC7–AC9), attempt-limit check (AC4), then key and model. If posting the attempt-limit check run fails, log it redacted and still end the job `failed`.
- Head repair order: enqueue the live head first, then the fenced self-supersede (a no-op if the enqueue already superseded it). The enqueue runs on the write-database runner, because `enqueueReviewJob` needs `.transaction()`. It skips when a job for that head already succeeded or is active (AC8) or the repo's current settings wouldn't review the PR (AC9), using the same rule as the webhook. The repaired job has no delivery id.
- Closed check uses the PR state from `getPullRequest`; any state other than `open` supersedes. The webhook's `closed` action runs before the mode, label and suspension gates, needs only that the repo is tracked, supersedes every queued or running job for that PR, does not ping the worker, and logs `review_job.superseded` with reason `pr_closed` and the count. Running jobs stop at their next heartbeat.
- Ingest runs upsert, findings replace and graph save in one transaction. The review upsert locks the review row, which serialises concurrent ingests on Postgres (manual; PGlite serialises anyway). Invalid records and owner mismatches still return their existing results without writing.
- The no-key check run is already `neutral`; it stays as is.
- An unreadable key is distinct from no key (no row). A missing `MODEL_KEY_ENCRYPTION_KEY` already fails at worker boot and is untouched.
- Token refresh is lazy, on the next GitHub call after 50 minutes by `now()`; jobs under 50 minutes mint exactly one token as today. Each minted token is pushed into the same secrets list the logger and `traceSecrets` already read.
- Redaction of a crash happens inside `runReviewJob`, which knows the secrets; `runWorker` logs what it receives.

## Contracts

- `packages/db` review-jobs: `renewReviewJobLease`, `completeReviewJob`, `supersedeReviewJob` and `failReviewJob` take the claimed job's id and attempts (or the job) instead of the id alone; return types unchanged. New function to supersede all active jobs for a repo's PR, returning the count. New query for whether a job for (repo, PR, head) has succeeded or is active. `enqueueReviewJob` unchanged.
- `packages/db` ingest: `ingestReviewRecord` requires a transaction-capable database (documented like `enqueueReviewJob`).
- `packages/db` model keys: a decryption failure in `readModelKey` raises a distinct, exported error type.
- `packages/github`: `PullRequestDetails` gains a required `state` (`"open" | "closed"`). The local git client, the eval fixture client, the agent test support fake and the conformance suite return or assert `"open"`. Clients built for a job can obtain a refreshed token (mechanism left to the plan).
- The webhook's "would this PR be reviewed now" rule is shared so the worker's head repair uses the same one.
- `apps/worker`: `JobRunnerDeps` gains a write-database runner (`withWriteDatabase` in production) used for dashboard ingest and head-repair enqueue, and `now(): number` (defaults to `Date.now`). `runReviewJob` never rejects with an unredacted secret.
- `apps/web` webhook: handles `pull_request` action `closed`.
- New log events: `review_job.attempts_exhausted`, `review_job.model_key_unreadable`; reason `pr_closed` on `review_job.superseded`.
- No schema change, no migration, no new env var.

## Non-goals

- Cloud Run request timeout and CPU settings (sunnyeyles/lintcat#291).
- Multi-key support or rotation tooling for `MODEL_KEY_ENCRYPTION_KEY`.
- Revoking installation tokens at job end.
- Re-reviewing on reopen beyond what already happens.
- Any change to the review pipeline's findings, prompts or rendering.

## Constraints

- The check run is always advisory (AGENTS.md invariant); nothing unvalidated reaches GitHub.
- Only dashboard ingest and head-repair enqueue use the WebSocket write pool; claim, heartbeat and settle stay on the HTTP driver.
- Tests use PGlite and fakes; no model calls, no network.
- Comments at most 2 lines (AGENTS.md).

## Human steps

None

## Open questions

None
