# Evaluation

Outcome metrics come from the run history. They change nothing.

## `factory report`

```bash
node apps/factory/start.mjs report [--json] [--repo <path>] [--since-days <n>]
```

Metrics are per profile, over finished runs (`delivered`, `failed`, `cancelled`) that reached a profile. The code is in `apps/factory/src/engine/metrics.ts`.

| Metric | Definition |
| --- | --- |
| Verified delivery rate | delivered ÷ finished runs. A run is delivered only when every check passed in the offline sandbox, with no human step after approval. A cancel counts against the rate. |
| First-pass success | delivered with no `repair_started` event ÷ finished runs |
| Wall time, median and p95 | first `run_started` to `finished_at`, so time spent waiting for approval doesn't count. Nearest-rank percentiles. |
| Command failure rate | commands with a non-zero exit or a timeout ÷ all commands. Commands in the `reproduce` stage are left out, because a failing regression test is that stage's goal. |
| Repeated-failure rate | runs with a `repeated_failure` event ÷ runs where some `checks_finished` had a failing check |
| Repair success | runs with a `repair_started` event that were delivered ÷ runs with a `repair_started` event |
| Test regression rate | runs where a check that passed in `baseline_recorded` later failed in `checks_finished` ÷ runs with a baseline. Only `refactor` records a baseline, so other profiles show `-`. |
| Deploy prerequisites | runs whose last `deploy_impact_finished` has a `prerequisite` finding ÷ runs with a `deploy_impact_finished` event. Runs before workflow `@2` never reach the stage, so they show `-`. |
| Cost per verified success | the sum of `outcome.usage.estimatedCostUsd` ÷ delivered runs. Runs with no cost figure are counted and reported as unknown. This is the runtime's estimate. On a subscription it is notional, not a bill, and the report says so. |

`-` means the history can't support the figure, for example no repairs or no baseline. Event kinds the metrics don't read are counted and listed but never cause an error. Human rework after delivery isn't recorded, so it isn't reported.

## Retention

```bash
node apps/factory/start.mjs prune [--days <n>]   # default FACTORY_RETENTION_DAYS, else 90
```

`prune` deletes the events and commands of runs that finished before the cutoff. Run rows and their outcomes stay. Metrics that need events, such as wall time or repairs, can't be computed for pruned runs.
