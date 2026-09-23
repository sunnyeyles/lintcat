# Evals

`pnpm eval` — real pipeline, real model, real token spend. Needs an API key;
`pnpm test` never calls a model.

The harness itself is not model-backed, and `pnpm test` covers it: the
`*.test.ts` files beside the sources below run in the fast suite, so a bug in
diff construction, fixture loading or an anchor fails there rather than
showing up as a quality regression in the paid run. `vitest.config.ts` is that
project; `vitest.eval.config.ts` still matches only `*.eval.ts`.

## What is evaluated

Codebase architecture: dead code, duplication and layering. Five fixtures,
seven assertions. Four are recall signals, one per planted problem; the rest
are precision signals.

Every fixture is the same small billing API (`ledgerly/billing-api`): routes,
services, data and db layers, with the boundaries written down in its
`ARCHITECTURE.md`. Each pull request adds one architecture problem to it.

| Fixture | Planted problem | Assertion | Signal |
| --- | --- | --- | --- |
| `architecture-dead-module` | the route switches to a new PDF renderer and `src/pdf/legacy-template.ts` is left with no importer | a finding lands on the new import in `invoice-pdf.ts` or the head of `render-invoice.ts` | recall |
| `architecture-duplicate-helper` | a new reminder email builds its own `formatAmount`, a copy of `formatMoney` in `src/lib/money.ts` | a finding lands on `formatAmount` | recall |
| `architecture-duplicate-helper` | | every proposed patch matches the file at head | precision |
| `architecture-layer-bypass` | a new CSV route imports `db` directly, past the service layer, and so drops its voided-invoice rule | a finding lands on the import or the query | recall |
| `architecture-dead-export` | the last caller of `daysOverdue` moves to a new `agingBucket` that repeats the same arithmetic, and the export stays | a finding lands on `src/lib/dates.ts` or the new import in `collections.ts` | recall |
| `clean-shared-money-format` | none: two drifted formatters become one shared helper that imports from a file outside the diff | zero findings | precision |
| `clean-shared-money-format` | | every proposed patch matches the file at head | precision |

A review whose agent fails throws, so a crashed run fails the whole fixture
rather than reading as a quality result.

Three of the four recall fixtures cannot be solved from the diff alone. The
dead module and the dead export are only dead if nothing else imports them,
and `formatMoney` is only a duplicate once the reviewer has found it. The
reviewer has to use `find_references` and `search_repository` to see any of
the three.

`patches-verify` is precision only: proposing no patch passes it. What fails is
a patch whose quoted `expected` lines do not match the file, which is the one
thing about a fix a unit test cannot check — whether the model counted lines
correctly against a real tree.

The clean fixture is what makes the other assertions mean anything. A reviewer
that reports nothing passes it and fails every recall assertion; one that
reports everything passes every recall assertion and fails it. It is built
around the false positive the reviewer has actually produced: calling an
import missing because the module it names sits outside the diff.
`src/lib/money.ts` imports `minorUnits` from `src/lib/currency.ts`, which the
pull request never touches.

Assertions match on location, never wording — see `expectations.ts`. Anchors
must match exactly one line of a changed file, and `cases.test.ts` resolves
every one of them in `pnpm test`. A fixture edit that moves a planted problem
therefore fails there, not in a paid run. Validation drops a finding whose line
is not an added line, so a finding on unchanged code in an anchored file only
counts when it is file-level. The one reviewer stamps `general` on every
finding, so category is not judged.

## The repository-index gate

The index is kept only if it is measured to help, and this is where that is
decided.

**The fixture.** `architecture-dead-module`. The pull request swaps the import
in `src/routes/invoice-pdf.ts` from `../pdf/legacy-template.js` to a new
`../pdf/render-invoice.js`. Whether the old module is now dead depends on every
other file in the repository, and the diff shows none of them. Every import in
the fixture is relative, so the fixture does not depend on alias resolution.

**The control switch.** `EVAL_INDEX=off` makes the fixture client report the
archive unavailable. `buildReviewIndex` then logs `index.failed` and returns
undefined, so the reviewer gets the absent one-liner and falls back to the
other tools. The identical suite runs on one changed variable.

```bash
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 pnpm eval                 # index on
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 EVAL_INDEX=off pnpm eval  # control
```

**The gate.** Recall on `architecture-dead-module` with the index on versus
off. If it does not move, the feature stops here: no persistence, no SCIP, no
second language.

**No numbers yet.** The earlier runs were on a suite of correctness, security
and performance fixtures that has since been replaced. Their results do not
carry over, so both arms of the gate still have to run on this suite.

Every run ends with a token-spend table — steps, the four token counters, an
estimated cost and the assertion tally per fixture — and writes the same
numbers to `evals/results/<time>-<provider>-<model>.json`. Commit the file
when a run is meant as evidence, so a cost change has a before and an after.

## Known gaps

- **No fixture has reached a model.** The five fixtures load, diff and resolve
  their anchors in `pnpm test`, but none has been reviewed by a model yet, so
  whether each planted problem is findable is unproven.
- **Only architecture is measured.** Correctness, security, performance, test
  coverage and docs drift are still in the reviewer's prompt, but no fixture
  checks them any more.
- **No fixture requires a patch.** `patches-verify` catches a wrong patch but
  cannot notice a reviewer that never proposes one, so fix recall is unmeasured.
- **`claude-haiku-4-5` does not clear the suite**, which is why the Anthropic
  default is `claude-sonnet-5`.
- **One sample per arm.** A fixture is one non-deterministic review, so a
  single on-versus-off pair is a signal, not a measurement. Repeat the pair
  before concluding anything.
- **The dead code itself cannot be anchored.** A finding must name a changed
  file, so `legacy-template.ts` and the unchanged `daysOverdue` lines cannot
  carry one. The recall assertions anchor the change that orphaned them instead.

## Layout

```
cases.ts               the spec: fixtures and their expectations
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
