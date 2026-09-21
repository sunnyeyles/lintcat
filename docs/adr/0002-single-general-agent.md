# 2. One general agent, no specialists, no synthesiser

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** sunny
- **Supersedes:** [0001](0001-general-agent-versus-five-specialists.md)

## Decision

A review is one agent. The `general` agent, whose brief covers correctness,
security, performance, tests and documentation, reviews every pull request in a
single tool loop, and deterministic validation follows it. The five specialists
(`security`, `correctness`, `performance`, `test-coverage`, `docs-drift`) and
the Synthesiser are removed.

## Why

Simplicity, and cost. Five specialists meant five agentic tool loops plus a
synthesis call per pull request, and the machinery to select, gate and merge
them: a config file, an `agents` input, per-agent models, path filters, a
join step, a synthesiser prompt, and per-agent rows and charts in the
dashboard. One agent is one loop and none of that.

## What 0001 established, and did not

[0001](0001-general-agent-versus-five-specialists.md) could not run the
comparison it was written for: the model credential was over its usage limit,
so **no evidence exists that the specialists find more, or less, than the
general agent.** This decision does not claim otherwise. It is the owner's call
to trade the unmeasured possible recall of specialists for a much smaller
system, and to measure the one remaining agent with the eval suite instead.

## What was removed

- **Agents:** `packages/ai/src/agents/specialists/`, `synthesiser.ts`,
  `agent-set.ts`, `config.ts`, `path-filter.ts`, and the `picomatch` and `yaml`
  dependencies.
- **Configuration:** `.github/pr-review-agents.yml`, the action's `agents` and
  `agent-config` inputs, the CLI `--agents` flag, and the MCP
  `list_review_agents` and `validate_agent_config` tools. There is no agent
  selection, no per-agent model and no path gating.
- **Pipeline:** the fan-out, `join` and `synthesise` steps, agent-failure
  tolerance, and the "no agent matched" check run. The agent failing fails the
  run.
- **Dashboard and DB:** per-agent runs, chips and charts. Token totals live on
  the review itself.

## Consequences

- Every finding carries the `general` category. Older stored findings keep
  their specialist categories.
- Repository memory matches suppressions and hints on title shape alone, so
  entries recorded under a specialist category keep working.
- The ingest endpoint ignores the old `agents`, `agentRuns` and `finding.agent`
  fields, so an older action can still report.
- A repository that wants a narrower review can no longer ask for one. If the
  eval suite shows the general agent missing a class of problem, the fix is its
  brief, not a second agent.
