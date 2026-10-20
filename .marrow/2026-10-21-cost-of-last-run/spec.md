# Spec: Cost column in a repository's review history

**Feature:** cost-of-last-run

## Problem

On a repository's page (`/o/[slug]/repos/[owner]/[name]`), the Review history table shows each run's findings and duration but not what it cost. To see a run's cost, an organization member has to switch to the Reviews page or open the review itself. Every row already has the cost, so the table only needs to show it.

## Outcome

Each row of a repository's Review history shows that run's estimated model cost in a Cost column, between Duration and When. It's formatted the same way as the Cost column on the Reviews page.

## Acceptance criteria

- AC1: Given `REPO_HISTORY_COLUMNS`, when it is read, then it is exactly `pullRequest, head, risk, findings, duration, cost, ran`, in that order.
- AC2 (manual, checked in review): Given `apps/web/app/o/[slug]/repos/[owner]/[name]/page.tsx`, when it renders Review history and its loading skeleton, then both take their columns from `REPO_HISTORY_COLUMNS` imported from `@/components/overview`, and the page defines no column list of its own.
- AC3: Given `ReviewsTable` rendered with `renderToStaticMarkup`, `columns={REPO_HISTORY_COLUMNS}`, `groupByPullRequest`, and two reviews of one pull request with `costUsd` 0.12 and 0.0042, when the markup is read, then the headers are "Pull request, Head, Blast radius, Findings, Duration, Cost, When" in that order, the "Cost" header has `text-right`, and `$0.12` and `$0.0042` each appear in a different row, with no total shown.
- AC4 (manual): Given a repository with reviews, when its page loads, then each Review history row's Cost matches the same review's Cost on the Reviews page.

## Behaviour details

- The column is the existing `cost` entry in `COLUMNS` in `apps/web/components/overview/reviews-table.tsx` ("Cost", right-aligned, `formatUsd(row.costUsd)`). Don't add a new column definition.
- In the grouped view (several runs of one pull request), every row shows its own run's cost, not a total for the PR.
- `costUsd` is always a number. `formatUsd` already renders 0 as `$0.00` and a non-finite value as `—`. No new empty state is needed.
- The table already switches to its wide `min-w-[54rem]` layout above 5 columns, and the skeleton's column count follows the list's length, so neither needs changing.
- Access is unchanged: the page already reads through `data(slug)` behind `requireRepo`.

## Contracts

- New export `REPO_HISTORY_COLUMNS: readonly ReviewColumn[]`, defined in `apps/web/components/overview/reviews-table.tsx` and added to its existing re-export in `components/overview/index.ts`. It replaces the page-local `HISTORY_COLUMNS` in `apps/web/app/o/[slug]/repos/[owner]/[name]/page.tsx`. A Next.js `page.tsx` can't export it.
- Tests for AC1 and AC3 go in a new `apps/web/components/overview/reviews-table.test.tsx`, using `renderToStaticMarkup` the way `apps/web/components/review/review-summary.test.tsx` does.
- No schema, query, route or env change.

## Non-goals

- No cost column in the overview's Recent reviews table or the repositories table.
- No per-PR cost total, sorting or filtering by cost.
- No change to how cost is computed or stored.
- No new test infrastructure (jsdom, testing-library).
- Don't move `RECENT_COLUMNS` (overview page) or the Reviews page's `COLUMNS`; they stay page-local.

## Constraints

None

## Human steps

None

## Open questions

None
