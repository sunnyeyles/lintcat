# Incremental review

*Status: proposed. Nothing below is implemented.*

A review today reads `base...head` every time. A pull request pushed to ten
times is reviewed ten times over its whole diff, and the ninth run re-reads
every line the first eight already cleared. At roughly 1.58M input tokens for
one review of [PR #11](../README.md#what-a-review-costs), that is the largest
avoidable cost in the system.

**Incremental review narrows the diff the agents are handed to the commits
added since this pull request was last reviewed.** Everything else — the trust
boundary, validation, patch verification, memory — is untouched.

---

## Where the baseline comes from

No new state, no new store, no new permission. The `AI PR Review` check run is
already written against each head commit, so the check run history *is* the
record of what was reviewed.

Walk the pull request's commits newest to oldest and take the first one, other
than the current head, carrying a completed `AI PR Review` check run. That
commit is `sinceSha`.

The lookup never fails a review. It degrades to a full review, with a logged
reason, when:

| Situation | Reason |
| --- | --- |
| No check run on any earlier commit | `no_baseline` — the first review, or `checks: write` was absent |
| The commit list or check runs cannot be read | `baseline_unreadable` |
| `sinceSha` is not an ancestor of the head | `head_rewritten` |

The third is the important one. A force-push or a rebase leaves a `sinceSha`
that describes commits no longer on the branch, and a diff against it would be
nonsense. `compareCommits(sinceSha, headSha)` must report `ahead`; `diverged`
and `behind` both fall back.

## Resolving the scope

A new module, `packages/reviewer/src/review-scope.ts`, owns the decision and
hands the pipeline one value:

```ts
type ReviewScope =
  | { kind: "full"; reason: string; diff: string; changedFiles: ChangedFile[] }
  | { kind: "incremental"; sinceSha: string; diff: string; changedFiles: ChangedFile[] };
```

`reviewPullRequest` calls it in place of today's `getDiff` / `listChangedFiles`
pair, and reads `scope.diff` and `scope.changedFiles` from then on.

### The base-merge trap

`sinceSha...headSha` includes whatever arrived by merging the base branch into
the pull request branch. Those files are not this pull request's work, and
reviewing them would be both wrong and expensive.

The incremental file set is therefore the **intersection** of the files the
comparison reports with the files the pull request itself changed. A file that
only moved because `main` moved is dropped.

### An empty increment

The intersection can be empty — a merge commit that changed nothing of the
pull request's own, or a push touching only files outside it. No agent runs.
The previous verdict is re-published (see *Carrying findings forward*), and the
run logs `review.incremental.no_changes`.

This is not the "no agent reviewed this pull request" case the README rules
against. There, nothing had ever read the change; here an earlier review did,
and its result is what gets re-stated.

## What the agents see

The opening message carries the incremental diff and the full pull request's
changed-file list. `get_diff` continues to return the whole diff, so an agent
that needs the full picture asks for it and pays for it then — which is where
the saving comes from, since most turns will not need to.

One line joins each agent's prompt: the diff is the change since the last
review, earlier commits were already reviewed, and a finding must anchor to a
line in this diff.

[Path filters](../README.md#path-filters) gate on the incremental file set. An
agent whose paths have not moved since the last review has nothing new to say
and sits out.

Prompt caching is unaffected — the breakpoints are within one run, and the
opening message has always differed between runs.

## Validation and patches

Unchanged, and the narrowing comes free. Validation rule 4 already requires a
finding's line to be an *added* line in the diff, so an incremental diff
confines findings to genuinely new lines without a new rule. Patch
verification still reads the head commit and still quotes-and-checks.

## Carrying findings forward

An earlier review's findings live on as their inline comments, and
`listReviewComments` already reads them for the dedupe in `postedFindingKeys`.
The check-run summary must render them too, under a heading naming them as open
from earlier commits.

Without that, an incremental run reads as though the pull request came back
clean when its earlier findings are all still there. The conclusion stays
`neutral` while either set is non-empty.

## Configuration

One new Action input:

| Input | Required | Purpose |
| --- | --- | --- |
| `incremental` | no (default `false`) | Review only the commits added since the last review of this pull request, rather than the whole diff. Falls back to a full review whenever the baseline cannot be established. |

Default off. It changes what the agents are shown, which is a behaviour change
before it is a cost change, and the evals should carry it before the default
does.

## Observability

Two events, alongside the existing set:

- `review.scope_resolved` — `kind`, `sinceSha`, `incrementalFileCount`,
  `pullRequestFileCount`, and `reason` on a fallback.
- `review.incremental.no_changes` — the empty-intersection case.

`reviewCorrelation` is unchanged: `headSha` still greps one run end to end.

## Client additions

Three read-only methods on `GithubInstallationClient`:
`listPullRequestCommits`, `listCheckRunsForRef`, `compareCommits`. Nothing
gains a write.

## Testing

Unit, over `review-scope.ts`: the first review, a clean increment, a
force-push, a base merge that must be intersected away, an empty increment, and
unreadable check runs.

Eval: a fixture pull request with a bug introduced in its second commit.
Run one reviews both commits, run two only the second. Run two must still
report the bug, and must spend materially fewer input tokens.

## The trade

A bug introduced in an earlier commit, but only visible given the context the
newest commit adds, is now outside the diff the agents are handed. `get_diff`
means they *can* still reach it; nothing makes them.

That is a real loss of recall, mitigated and not removed, and it is what the
`incremental` input buys with its cost saving. A repository that would rather
pay leaves it off, which is where it ships.
