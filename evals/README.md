# Evals

`pnpm eval` — real pipeline, real model, real token spend. Needs an API key;
`pnpm test` never calls a model.

## What is evaluated

Six fixtures, fourteen assertions. Eight of them are quality signals; six
are health checks that stop a crashed agent from reading as a quality result.

| Fixture | Assertion | Signal |
| --- | --- | --- |
| `security-tenant-scope` | every agent completes | health |
| `security-tenant-scope` | a `security` finding lands on `findCustomerById` or `getCustomer` | recall |
| `security-tenant-scope` | every proposed patch matches the file at head | precision |
| `correctness-admin-check` | every agent completes | health |
| `correctness-admin-check` | a `correctness` finding lands on `getAuditEvents` | recall |
| `correctness-cross-file-caller` | every agent completes | health |
| `correctness-cross-file-caller` | a `correctness` finding lands on `ShippingQuote` or `quoteShipment` | recall |
| `test-coverage-untested-branch` | every agent completes | health |
| `test-coverage-untested-branch` | a `test-coverage` finding lands on `BULK_PARCEL_RATE` or `applyDiscount` | recall |
| `performance-n-plus-one` | every agent completes | health |
| `performance-n-plus-one` | a `performance` finding lands on `buildOrderSummary` | recall |
| `clean-pagination` | every agent completes | health |
| `clean-pagination` | zero findings | precision |
| `clean-pagination` | every proposed patch matches the file at head | precision |

`patches-verify` is precision only: proposing no patch passes it. What fails is
a patch whose quoted `expected` lines do not match the file, which is the one
thing about a fix a unit test cannot check — whether the model counted lines
correctly against a real tree.

The clean fixture is what makes the other five mean anything. A reviewer that
reports nothing passes `clean-pagination` and fails every recall assertion; one
that reports everything passes all five recall assertions and fails
`clean-pagination`. Only both halves together constrain recall and precision,
and `clean-pagination` now carries the precision signal for all five agents at
once.

Assertions match on category and location, never wording — see
`expectations.ts`. Anchors must match exactly one line of a changed file, so a
fixture edit that moves the planted bug fails loudly instead of silently
passing.

## The repository-index gate

The index is kept only if it is measured to help, and this is where that is
decided.

**The fixture.** `correctness-cross-file-caller` plants a bug no reader of the
diff can see. The pull request changes `ShippingQuote.total` in
`src/pricing/quote.ts` from a formatted string to a `Money` value and edits an
unrelated second file, `src/http/access-log.ts`. The bug is in a third file the
pull request never touches: `src/notifications/quote-email.ts` passes
`quote.total` straight into a template renderer that stringifies whatever it is
given, so the customer's email reads `SwiftPost can take your parcel for
[object Object].` `tsc` is clean on both trees — the renderer takes
`Record<string, unknown>` — so nothing but reading the untouched caller finds
it. Every import in the fixture is relative, so the fixture does not depend on
alias resolution.

**The control switch.** `EVAL_INDEX=off` makes the fixture client report the
archive unavailable. `buildReviewIndex` then logs `index.failed` and returns
undefined, so the agents get the absent one-liner and fall back to the other
tools. The identical suite runs on one changed variable.

```bash
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 pnpm eval                 # index on
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 EVAL_INDEX=off pnpm eval  # control
```

**The gate.** Recall on `correctness-cross-file-caller` with the index on
versus off. If it does not move, the feature stops here: no persistence, no
SCIP, no second language.

**The numbers so far — the gate is not yet decided.**

| Run | Result |
| --- | --- |
| Index on, 2026-09-19, `claude-sonnet-5` | 13 of 14 assertions passed in 282s. `index.built` over 7 files in 2ms. The `correctness` recall assertion on the cross-file fixture **passed**: one finding, landed on the changed function. All twelve pre-existing assertions passed, `clean-pagination` still at zero findings. The one failure was the cross-file fixture's health check — the `security` agent returned unparseable JSON, which is the flake the model notes below describe, not a recall result. |
| Index off, 2026-09-19, `claude-sonnet-5` | **Incomplete.** `security-tenant-scope` and `correctness-admin-check` passed all five of their assertions, and `index.failed` was logged for every fixture, so the absent path is exercised end to end. The run then died 107s in: the Anthropic account hit `You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.` Every agent on the cross-file fixture failed with that error, so **there is no control number for the gate's own fixture**. |

The on arm cost 1.5k input, 28k cache-write, 199k cache-read and 8.8k output
tokens on the cross-file fixture alone.

Until the control arm runs to completion, the on arm's pass is one sample and
proves nothing on its own: the gate needs both halves.

## Known gaps

- **`docs-drift` has no quality assertion.** Four of the five agents
  `.github/pr-review-agents.yml` ships have a recall fixture; `docs-drift` is
  the one that does not, and is exercised only as "did not crash, stayed quiet
  on clean code".
- **No fixture requires a patch.** `patches-verify` catches a wrong patch but
  cannot notice a reviewer that never proposes one, so fix recall is unmeasured.
- **The Anthropic default model does not clear the suite.** On
  `claude-haiku-4-5` most agents, the two original ones included, hit the
  turn cap or return unparseable JSON. Run Anthropic with
  `MODEL_ID=claude-sonnet-5`, which is what the five-agent run was checked on.
  Sonnet is not immune: on the 2026-09-19 run the `security` agent returned
  unparseable JSON on one fixture, which fails that fixture's health check
  without saying anything about recall.
- **One sample per arm.** A fixture is one non-deterministic review, so a
  single on-versus-off pair is a signal, not a measurement. Read the gate with
  that in mind, and repeat the pair before concluding the index does nothing.

## Layout

```
cases.ts               the spec: fixtures and their expectations
expectations.ts        the judge: category + anchored location
fixture.ts             loads repo/ (head) and base/ into the pipeline's inputs
fixture-client.ts      GithubInstallationClient over a fixture; writes throw,
                       and EVAL_INDEX=off withholds the archive
unified-diff.ts        synthesises patches from the two trees
run-fixture-review.ts  drives the real pipeline; only client and publish differ
model-access.ts        credentials, and the fail-fast before any spend
```

## Adding a fixture

1. `fixtures/<name>/fixture.json` — the manifest, plus `repo/` (tree at head)
   and `base/` (previous contents of modified files only).
2. Add the case to `cases.ts` with `agentsCompleted` and its real expectation.

Anchor to a marker that appears once in the file.
