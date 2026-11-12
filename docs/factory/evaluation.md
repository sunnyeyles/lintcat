# Evaluation

Stage 5 measures the factory three ways. Outcome metrics come from the run history. A learning report proposes changes from recurring failures. A benchmark compares configurations against checks the agent never sees. None of them changes prompts, workflows or configuration.

## `factory report`

```bash
node apps/factory/start.mjs report [--json] [--repo <path>] [--since-days <n>]
```

Metrics are per profile, over finished runs (`delivered`, `failed`, `cancelled`) that reached a profile. The code is in `packages/factory/src/metrics.ts`.

| Metric | Definition |
| --- | --- |
| Verified delivery rate | delivered ÷ finished runs. A run is delivered only when every check passed in the offline sandbox, with no human step after approval. A cancel counts against the rate. |
| First-pass success | delivered with no `repair_started` event ÷ finished runs |
| Wall time, median and p95 | first `run_started` to `finished_at`, so time spent waiting for approval doesn't count. Nearest-rank percentiles. |
| Command failure rate | commands with a non-zero exit or a timeout ÷ all commands. Commands in the `reproduce` stage are left out, because a failing regression test is that stage's goal. |
| Repeated-failure rate | runs with a `repeated_failure` event ÷ runs where some `checks_finished` had a failing check |
| Repair success | runs with a `repair_started` event that were delivered ÷ runs with a `repair_started` event |
| Test regression rate | runs where a check that passed in `baseline_recorded` later failed in `checks_finished` ÷ runs with a baseline. Only `refactor` records a baseline, so other profiles show `-`. |
| Escalation rate | runs with `profile_escalated` ÷ finished runs |
| Cost per verified success | the sum of `outcome.usage.estimatedCostUsd` ÷ delivered runs. Runs with no cost figure are counted and reported as unknown. This is the runtime's estimate. On a subscription it is notional, not a bill, and the report says so. |

`-` means the history can't support the figure, for example no repairs or no baseline. Event kinds the metrics don't read, such as a kind added in a later stage, are counted and listed but never cause an error. Human rework after delivery isn't recorded, so it isn't reported.

## Learning report

`packages/factory/src/learning.ts`. It uses deterministic rules and calls no model.

1. **Occurrences.** These are failed commands (outside `reproduce`), `repeated_failure` events and the blockers of failed runs.
2. **Clusters.** Occurrences are grouped by source, `stage/command`, error category and a normalised signature. The signature is the first line of output that reads like an error, with ANSI codes, paths, hex ids, run ids, quoted values and numbers stripped. A cluster needs at least two distinct runs.
3. **Root cause and candidates.** The first matching rule supplies a likely root cause and one or more candidate changes. Each candidate is tagged `prompt`, `tool`, `context`, `workflow` or `sandbox`. Examples: `command_not_found` → sandbox image; `timeout` → workflow budget; exit 137 → sandbox memory; "failed identically" → repair prompt; "made no changes" → context and prompt; a check that fails the same way in several runs → the implementer prompt. A fallback rule gives confidence 0.2 and says to read the evidence.
4. **Confidence.** The rule's base confidence is scaled by `min(1, 0.6 + 0.1 × runs)` and capped at 0.95. These are hypotheses, never facts.

### Lessons (learning memory)

Each candidate becomes a row in `factory_lessons`. The key is `target:clusterHash`, so the same finding never appears twice. A row holds scope (`profile:<name>` or `all-profiles`), title, root cause, proposal, confidence, evidence run ids, occurrences, first and last seen, and `expires_at`, which is last seen plus 30 days. The status is `proposed` or `retired`.

- Writing these rows is the report's only write. Evidence is merged as a union, so pruned history never shrinks it.
- A proposed lesson whose `expires_at` has passed is retired with the reason `expired`. If the failure recurs after that, the lesson is proposed again. A lesson a human retired stays retired.
- Lessons are never injected into agent context in the MVP. A person reads them and decides.

### Retention

```bash
node apps/factory/start.mjs prune [--days <n>]   # default FACTORY_RETENTION_DAYS, else 90
```

`prune` deletes the events and commands of runs that finished before the cutoff. Run rows, their outcomes and the lessons stay. Metrics that need events, such as wall time or repairs, can't be computed for pruned runs.

## Benchmark

```bash
node apps/factory/start.mjs bench run --config benchmarks/factory/configs/baseline.json [--fixture quick,bugfix] [--keep]
node apps/factory/start.mjs bench compare benchmarks/factory/configs/baseline.json benchmarks/factory/configs/no-repair.json
```

`evaluate` is an alias for `bench`. A run uses the same auth, database and Docker sandbox image as `factory run`. Run `factory init` first, which builds the image and applies migrations.

### Fixtures

`benchmarks/factory/fixtures/<name>/` contains:

- `repo/`: the starting files. `buildFixture()` (`packages/factory/src/bench/fixtures.ts`) commits them with a fixed author, committer and date (2026-01-01), with user and system git config disabled. It then refuses the repo unless HEAD equals `fixture.json`'s `baseSha`. Changing a fixture therefore means recording a new SHA.
- `spec.json`: the approved spec, valid against `specSchema`, so a run needs no discovery.
- `fixture.json`: a description, the `.factory/checks` line and `baseSha`.
- `hidden/`: the independent checks.
- `reference/`: a known-good solution. It is used only by the harness's own tests, to prove that the hidden checks fail on the base and pass on a correct change.

| Fixture | Task | Profile it routes to |
| --- | --- | --- |
| `greenfield` | create `src/slugify.mjs` in an almost empty repo | quick |
| `quick` | add an `excited` option to `greet` | quick |
| `bugfix` | fix a `median` that sorts as strings, mutates its input and ignores even lengths, while the visible test passes | bugfix |
| `refactor` | extract three copies of money formatting into `src/money.mjs` without changing output | refactor |

### How the hidden checks stay independent

- They live in `benchmarks/factory/fixtures/*/hidden`, outside the temporary fixture repo. The agent's file tools are confined to its worktree, and its commands run in a sandbox that mounts only that worktree. It can't see them.
- After the run, the harness makes a fresh `git clone --no-local` of the delivered branch. It checks that the branch descends from the fixture's `baseSha`, copies the hidden tests in, and runs `node --test` in a new offline sandbox.
- **verified** = the factory delivered *and* the hidden checks passed. The factory's own verdict is recorded as `claimedChecksPassed` and `factoryStatus`, and a delivery that fails the hidden checks counts as a *false claim*. The agent's self-reported status (`done` or `partial`) is never read.

### Configurations

`benchmarks/factory/configs/*.json` is validated by `benchConfigSchema`:

| Field | Effect |
| --- | --- |
| `name` | label; results go to `results/<name>-<hash8>/` |
| `model` | passed as the agent's model on every agent run |
| `budgets` | overrides any of the contract's budgets before approval |
| `profileOverride` | routes through the router's normal override rules |
| `fixtures`, `repeat` | which fixtures to run, and how many times each |

The config hash is the sha256 of the parsed, key-sorted config, so formatting changes don't split one configuration in two. Every result also records the run's `workflowVersion`, the `promptVersions` seen in its events and the `toolVersion`. A prompt or workflow edit is visible in the comparison even under the same config. To compare prompt sets, run the same config before and after the edit, and the header shows both prompt versions.

### Results and comparison

Each fixture run writes one JSON file under `benchmarks/factory/results/` (gitignored). It records the config name, hash and model, the fixture and its SHA, run id, profile, versions, factory status and blocker, the hidden check exit code and bounded output, `verified`, repairs, wall time and estimated cost. `bench compare <a> <b>` accepts config files or result directories. It prints a per-profile table of verified count and rate, first-pass rate, false claims, median wall time and estimated cost per verified success, each with a B − A delta, followed by per-fixture verified counts.

Benchmark runs go to the same database as real runs, each from its own temporary repo. To see only one repository's runs, use `factory report --repo <path>`.
