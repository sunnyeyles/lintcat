# 1. The general agent versus the five specialists

- **Status:** Superseded by [0002](0002-single-general-agent.md)
- **Date:** 2026-09-21
- **Deciders:** sunny
- **Issue:** [#126](https://github.com/sunnyeyles/pr-review-agents/issues/126)
- **Blocks:** [#127](https://github.com/sunnyeyles/pr-review-agents/issues/127)

## Verdict

**Not established.** No agent is retired on this evidence, because there is no
evidence: the paired run this decision was meant to rest on could not be made.
Every agent in `.github/pr-review-agents.yml` survives by default, not by
merit. #127 must be re-scoped as "re-run the pair, then decide", and must not
proceed as "remove or merge agents" on the strength of this document.

## Context

The repository ships five specialist reviewers — `security`, `correctness`,
`performance`, `test-coverage`, `docs-drift` — and a single `GENERAL_AGENT`
whose brief covers all five areas and which is what reviews a repository that
configures nothing. Five agents means five agentic tool loops per pull request
plus a synthesis call; one agent means one loop and no synthesis. If the
specialists do not find materially more, they are a straight multiple of the
model bill for nothing.

The eval suite could not answer this before now. It ran whatever agent set the
fixtures happened to configure, so the two arms could not be compared on one
changed variable, and `docs-drift` had no recall fixture at all — leaving a
plausible survivor entirely unmeasured. Its retrieval program (search every
document that mentions a touched symbol, then read the passage) is one the
general agent's brief mentions but never obliges it to run.

## What was built

Both are on the branch this ADR lands with, and both are covered by `pnpm test`.

1. **`EVAL_AGENTS`**, an arm switch in the same shape as the existing
   `EVAL_INDEX` control switch. Unset, the suite runs the configured
   specialists; `EVAL_AGENTS=general` runs `GENERAL_AGENT` alone. Nothing else
   about the run changes, so the suite is identical across the two arms.
2. **`docs-drift-retry-budget`**, the missing fixture. A pull request replaces
   a retry attempt count with a wall-clock budget: `NOTIFY_MAX_RETRIES` becomes
   `NOTIFY_RETRY_BUDGET_MS` in `src/config.ts`, and `withAttempts` becomes
   `withRetryBudget` in `src/delivery/retry.ts`. Two untouched documents,
   `README.md` and `docs/runbook.md`, still describe five attempts and still
   tell an operator to raise `NOTIFY_MAX_RETRIES` — wrong only because of this
   diff. The drift is invisible in the diff and reachable only by searching the
   repository for the renamed symbol. The recall assertion anchors
   `export const RETRY_BUDGET_ENV` and `export async function withRetryBudget`,
   each matching exactly one line of a changed file.

The suite is now seven fixtures and sixteen assertions, nine of them quality
signals.

## Evidence

**There is none for the comparison.** On 2026-09-21 the repository's only model
credential, the Anthropic key in `.env.local`, was over its account usage limit:

```
{"type":"error","error":{"type":"invalid_request_error",
 "message":"You have reached your specified API usage limits.
  You will regain access on 2026-10-01 at 00:00 UTC."}}
```

Every request in both arms was rejected before a token was billed:

| Arm | Agents started | Outcome | input | cache-write | cache-read | output |
| --- | --- | --- | --- | --- | --- | --- |
| specialists (default) | security, correctness, performance, test-coverage, docs-drift | all five failed `AI_APICallError` | 0 | 0 | 0 | 0 |
| general (`EVAL_AGENTS=general`) | general | failed `AI_APICallError` | 0 | 0 | 0 | 0 |

That table is the wiring working, not a result: the right agent set starts on
each arm, the new fixture loads, diffs and reaches the agents, and the index
builds over its twelve files in 2ms. It says nothing about recall, precision or
cost. The per-anchor recall, the `clean-pagination` precision and the four token
counters that #126 asks for are all still unmeasured.

The nearest thing to a cost figure is one specialist-arm fixture from the
2026-09-19 index-gate run: 1.5k input, 28k cache-write, 199k cache-read and
8.8k output tokens on `correctness-cross-file-caller`. It has no general-arm
counterpart, so it bounds nothing.

## The cost multiple, as far as it is known

Structurally the specialists run five agent loops and one synthesis call
against the general arm's single loop with synthesis skipped. That sets the
ceiling at roughly five times the agent spend plus synthesis, and the floor
above one, because the general agent's brief is longer and it must read for
five concerns rather than one — its single loop is not one-fifth of the
specialist arm. **The true multiple is somewhere between those two and has not
been measured.** Anyone quoting "5x" from this document is quoting arithmetic,
not a measurement.

## Decision

1. Keep all five specialists and the general agent. Nothing is removed,
   merged, or demoted on no evidence.
2. Land the arm switch and the `docs-drift` fixture, so the measurement is one
   command away once the account's budget resets on 2026-10-01.
3. Re-scope #127 from "remove or merge agents" to "run the pair, record the
   table, then decide". Re-open this ADR with the numbers, as
   `0002-…`, superseding this one.

The two commands, to be run once each:

```bash
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 pnpm eval
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 EVAL_AGENTS=general pnpm eval
```

## What this did not measure

Stated explicitly, because the gaps are larger than the findings.

- **Real pull requests.** Every fixture is a small synthetic repository with a
  deliberately planted problem and a plausible commit message. Nothing here
  predicts behaviour on a real diff, a large one, or one whose problem nobody
  planted.
- **False positives beyond one clean fixture.** `clean-pagination` is the
  entire precision signal. One clean pull request cannot estimate a rate; it
  can only catch a reviewer that invents findings constantly.
- **The two arms are not perfectly matched.** The general agent is
  `standalone`, so its arm skips the synthesis step that merges and filters the
  specialists' candidates. Any difference in precision is therefore partly a
  difference in pipeline, not only in reviewers.
- **Categorisation.** The general agent stamps `category: "general"` on
  everything it reports, so its findings are judged on location alone. The
  arms compare "did a reviewer point at the planted problem", not "did a
  reviewer classify it correctly".
- **Which specialist earned its keep.** Even a completed pair gives one number
  per fixture. Attributing a find to one agent, or showing that dropping one
  costs nothing, needs per-agent arms the switch supports (`REVIEW_AGENTS`) but
  which nobody has run.
- **Repeatability.** A fixture review is one non-deterministic sample. A single
  pair is a signal, not a measurement, and `claude-sonnet-5` has already been
  seen returning unparseable JSON on one fixture in an otherwise healthy run.
- **The new fixture's own calibration.** `docs-drift-retry-budget` has never
  been judged against a model. Its anchors may prove too tight, or the planted
  drift too easy.
- **Model and provider.** Nothing was run, but when it is, it will be one model
  on one provider. `claude-haiku-4-5` is already known not to clear the suite,
  so the arms say nothing about what a cheaper model changes.
