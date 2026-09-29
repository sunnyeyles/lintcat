# Evals

`pnpm eval` — real pipeline, real model, real token spend. Needs an API key;
`pnpm test` never calls a model.

The harness itself is not model-backed, and `pnpm test` covers it: the
`*.test.ts` files beside the sources below run in the fast suite, so a bug in
diff construction, fixture loading or an anchor fails there rather than
showing up as a quality regression in the paid run. `vitest.config.ts` is that
project; `vitest.eval.config.ts` still matches only `*.eval.ts`.

## What is evaluated

Codebase drift: a change that names or does something differently from how the
rest of the repository already does it. Nine fixtures, twelve assertions. Three
are recall signals, one per planted drift; the rest are precision signals.

Five fixtures are the same small billing API (`ledgerly/billing-api`): routes,
services, data and db layers, with the boundaries written down in its
`ARCHITECTURE.md`. The other four are small services of their own.

| Fixture | Planted problem | Assertion | Signal |
| --- | --- | --- | --- |
| `naming-drift-data-reads` | new credit-note reads are named `getCreditNoteById` and `fetchCreditNotesByInvoice`, where every other data module names them `find*` and `list*For*` | a finding lands on the new reads or the service that calls them | recall |
| `architecture-duplicate-helper` | a new reminder email builds its own `formatAmount`, a copy of `formatMoney` in `src/lib/money.ts` | a finding lands on `formatAmount` | recall |
| `architecture-duplicate-helper` | | every proposed patch matches the file at head | precision |
| `architecture-layer-bypass` | a new CSV route imports `db` directly, past the service layer every other route goes through | a finding lands on the import or the query | recall |
| `clean-no-convention-lib` | none: a helper joins `src/lib`, whose files share no naming or export convention | zero findings | precision |
| `clean-no-convention-lib` | | every proposed patch matches the file at head | precision |
| `clean-shared-money-format` | none: two drifted formatters become one shared helper that imports from a file outside the diff | zero findings | precision |
| `clean-shared-money-format` | | every proposed patch matches the file at head | precision |
| `correctness-admin-check` | a `since` filter keeps the events before the timestamp; the route otherwise follows its siblings | zero findings | precision |
| `correctness-cross-file-caller` | a quote's total becomes `Money`, as the pricing code already uses, and an untouched caller still renders it as a string | zero findings | precision |
| `security-open-redirect` | a new route redirects wherever its query string says; no other route redirects | zero findings | precision |
| `performance-n-plus-one` | the order summary looks a product up once per line, through a read named like its siblings | zero findings | precision |

A review whose agent fails throws, so a crashed run fails the whole fixture
rather than reading as a quality result.

The last four are real bugs that are not drift. They were recall fixtures for
the reviewer before it was refocused, and are kept as the cases a drift-only
reviewer must leave alone. Each was chosen, or trimmed, so that nothing in its
repository sets a precedent the bug departs from: the performance fixture has no
batch lookup to reuse, and the security fixture has no other redirect.

None of the recall fixtures can be solved from the diff alone. A convention is
only a convention once the reviewer has read the files that follow it, and a
finding survives validation only with two pieces of evidence in files the pull
request does not change. `drift-fixtures.test.ts` checks, in `pnpm test`, that
the naming fixture's convention is citable that way.

`patches-verify` is precision only: proposing no patch passes it. What fails is
a patch whose quoted `expected` lines do not match the file, which is the one
thing about a fix a unit test cannot check — whether the model counted lines
correctly against a real tree.

The clean fixtures are what make the other assertions mean anything. A reviewer
that reports nothing passes them and fails every recall assertion; one that
reports everything passes every recall assertion and fails them.
`clean-no-convention-lib` holds the line on the evidence rule: its neighbours
disagree with each other, so there is nothing to drift from.
`clean-shared-money-format` is built around a false positive the reviewer has
actually produced: calling an import missing because the module it names sits
outside the diff.

Assertions match on location, never wording — see `expectations.ts`. Anchors
must match exactly one line of a changed file, and `cases.test.ts` resolves
every one of them in `pnpm test`. A fixture edit that moves a planted problem
therefore fails there, not in a paid run. Validation drops a finding whose line
is not an added line, so a finding on unchanged code in an anchored file only
counts when it is file-level. Category is not judged: a duplicated helper is as
much `pattern` as `naming` drift, and either is right.

## The repository-index gate

The index is kept only if it is measured to help, and this is where that is
decided.

**The fixtures.** The three recall fixtures. With the index, the opening
message lists each changed file's siblings, and validation checks every piece
of evidence against the base commit. Without it, the reviewer has to find the
convention with `search_repository` alone, and validation can only reject
evidence that names a changed file.

**The control switch.** `EVAL_INDEX=off` makes the fixture client report the
archive unavailable. `buildReviewIndex` then logs `index.failed` and returns
undefined, so the reviewer gets the absent one-liner and falls back to the
other tools. The identical suite runs on one changed variable.

```bash
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 pnpm eval                 # index on
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 EVAL_INDEX=off pnpm eval  # control
```

**The gate.** Recall on the three recall fixtures with the index on versus
off. If it does not move, the feature stops here: no persistence, no SCIP, no
second language.

**No numbers yet.** No run of the drift suite has reached a model, so both arms
of the gate still have to run on it.

Every run ends with a token-spend table — steps, the four token counters, an
estimated cost and the assertion tally per fixture — and writes the same
numbers to `evals/results/<time>-<provider>-<model>.json`. Commit the file
when a run is meant as evidence, so a cost change has a before and an after.

## Known gaps

- **No fixture has reached a model.** The nine fixtures load, diff and resolve
  their anchors in `pnpm test`, but none has been reviewed by a model yet, so
  whether each planted problem is findable, and each out-of-scope bug left
  alone, is unproven.
- **Only naming and pattern drift are measured.** The reviewer's categories
  also cover docs, style and config drift, but no fixture checks them yet.
- **No fixture requires a patch.** `patches-verify` catches a wrong patch but
  cannot notice a reviewer that never proposes one, so fix recall is unmeasured.
- **`claude-haiku-4-5` does not clear the suite**, which is why the Anthropic
  default is `claude-sonnet-5`.
- **One sample per arm.** A fixture is one non-deterministic review, so a
  single on-versus-off pair is a signal, not a measurement. Repeat the pair
  before concluding anything.

## Layout

```
cases.ts               the spec: fixtures and their expectations
drift-fixtures.test.ts the naming fixture's evidence survives validation
expectations.ts        the judge: anchored location
fixture.ts             loads repo/ (head) and base/ into the pipeline's inputs
fixture-client.ts      the reads a fixture can serve; publishing is undeclared,
                       and EVAL_INDEX=off withholds the archive
*.conformance.test.ts  the shared adapter suite, @pr-review/github/conformance
unified-diff.ts        synthesises patches from the two trees
run-fixture-review.ts  drives the real pipeline; only client and publish differ
usage-report.ts        the token-spend table and results/ JSON every run writes
model-access.ts        credentials, and the fail-fast before any spend
*.test.ts              the harness's own unit tests, run by pnpm test
```

## Adding a fixture

1. `fixtures/<name>/fixture.json` — the manifest, plus `repo/` (tree at head)
   and `base/` (previous contents of modified files only).
2. Add the case to `cases.ts` with its real expectation.

Anchor to a marker that appears once in the file.
