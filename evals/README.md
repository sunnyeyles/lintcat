# Evals

`pnpm eval` — real pipeline, real model, real token spend. Needs an API key;
`pnpm test` never calls a model.

## What is evaluated

Six fixtures, fifteen assertions. Nine of them are quality signals; six
are health checks that stop a crashed agent from reading as a quality result.

| Fixture | Assertion | Signal |
| --- | --- | --- |
| `security-tenant-scope` | every agent completes | health |
| `security-tenant-scope` | a `security` finding lands on `findCustomerById` or `getCustomer` | recall |
| `security-tenant-scope` | every proposed patch matches the file at head | precision |
| `correctness-admin-check` | every agent completes | health |
| `correctness-admin-check` | a `correctness` finding lands on `getAuditEvents` | recall |
| `correctness-cross-file-caller` | every agent completes | health |
| `correctness-cross-file-caller` | a `correctness` finding lands on `DiscountResult` or `applyDiscount` | recall |
| `correctness-cross-file-caller` | every proposed patch matches the file at head | precision |
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

## The index gate

Every fixture is reviewed against a real `RepositoryIndex` built from its own
`repo/` directory: Layer A from the tree, and Layer B from `scip-typescript`
when the fixture ships a `tsconfig.json`. A Layer B build that throws — no
indexer on the box — is logged and the review continues on Layer A, the same
partial mode production degrades to. `EVAL_INDEX=off` skips the build entirely
and reviews in absent mode.

That switch is phase 2's gate in `docs/specs/repo-index.md`: resolution has to
earn its place.

```bash
pnpm eval                  # with the index
EVAL_INDEX=off pnpm eval   # without it
```

Run both and compare `correctness-cross-file-caller`, whose planted bug is
only reachable by resolving `applyDiscount` to a caller the pull request never
touches. If its recall does not improve with the index on, phase 2 stops.

The harness's own unit run needs no key and no model:

```bash
pnpm --filter @pr-review/evals test
```

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

## Layout

```
cases.ts                    the spec: fixtures and their expectations
expectations.ts             the judge: category + anchored location
fixture.ts                  loads repo/ (head) and base/ into the pipeline's inputs
fixture-client.ts           GithubInstallationClient over a fixture; writes throw
unified-diff.ts             synthesises patches from the two trees
run-fixture-review.ts       the real pipeline and the fixture's index; only
                            the client and the publish step differ
model-access.ts             credentials, and the fail-fast before any spend
run-fixture-review.test.ts  the harness's own unit run, on scripted agents
```

## Adding a fixture

1. `fixtures/<name>/fixture.json` — the manifest, plus `repo/` (tree at head)
   and `base/` (previous contents of modified files only).
2. Add the case to `cases.ts` with `agentsCompleted` and its real expectation.
3. Add its rows to the table above.

Anchor to a marker that appears once in the file. A fixture that wants Layer B
needs a `package.json` and a `tsconfig.json` in `repo/`, and no dependencies to
install.
