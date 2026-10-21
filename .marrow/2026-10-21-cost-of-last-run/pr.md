# Show each run's cost in a repository's Review history

## Summary

A repository's Review history now shows what each review run cost, in a right-aligned Cost column between Duration and When. The column list moves into a shared `REPO_HISTORY_COLUMNS` constant beside the reviews table, so the repo page and its loading skeleton take their columns from one place. Each row's cost uses the same `formatUsd(row.costUsd)` cell as the Reviews page.

## Acceptance

- AC1 pass: `REPO_HISTORY_COLUMNS` is exactly `pullRequest, head, risk, findings, duration, cost, ran`, in that order.
- AC2 manual: the repo page's Review history and its loading skeleton both take their columns from `REPO_HISTORY_COLUMNS` imported from `@/components/overview`, and the page defines no column list of its own.
- AC3 pass: `ReviewsTable` with `columns={REPO_HISTORY_COLUMNS}`, `groupByPullRequest` and two reviews of one pull request renders the headers "Pull request, Head, Blast radius, Findings, Duration, Cost, When" in that order, with a right-aligned "Cost" header, and `$0.12` and `$0.0042` in different rows with no total.
- AC4 manual: each Review history row's Cost matches the same review's Cost on the Reviews page.

## Tickets

- 01 Show each run's cost in a repository's Review history: merged

## Evidence

Checks (green):

- install: green
- typecheck: green
- lint: green
- dead-code: green
- test: green
- build: green
- smoke: green
- tree clean after checks: green

## Risk

Two-way door: a display-only change to one dashboard page, reverted by reverting this PR. Blast radius is the repository page's Review history table.

- [low] One page's column list moved into the shared table (`apps/web/components/overview/reviews-table.tsx:54`).
- `ReviewRow.id` is now a `string` (`String(review.id)` in `toReviewRow`), not the numeric `Review.id`, so that the acceptance test's string-id fixture typechecks. The row only uses it for links and React keys. Worth checking that you're happy with this rather than changing the test fixture to numbers.
- The `apps/mcp` `apply_fix` rollback test is now skipped when running as root, because root ignores `chmod 0o444`. It still runs in CI and for non-root users.
- No merge conflicts.

## Manual steps

- AC2: check that `apps/web/app/o/[slug]/repos/[owner]/[name]/page.tsx` takes its table and skeleton columns only from `REPO_HISTORY_COLUMNS`.
- AC4: load `/o/[slug]/repos/[owner]/[name]` for a repository that has reviews, and check that each Review history row's Cost matches the same review's Cost on the Reviews page.
- Make sure CI, which runs as non-root, runs the `apps/mcp` `apply_fix` rollback test and it passes.
