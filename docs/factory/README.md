# Software factory (MVP, stages 1–2)

The factory turns a conversation into a verified git branch. You describe an outcome, answer a few material questions, approve one spec, and the factory works unattended to a branch (or PR) or to an explained blocker.

## Layout

| Path | Role |
| --- | --- |
| `apps/factory` | CLI (`factory init/new/run/worker/status/logs/cancel/resume/result`), `compose.yaml` for Postgres |
| `packages/factory` | Core: contract, router, engine, store, sandbox, git, `task.md`, telemetry |
| `packages/factory/agents/*.md` | Versioned agent instructions (`role@version+contenthash` on every event) |
| `packages/factory/workflows/*.yaml` | Validated profile definitions |
| `packages/agent-runtime` | `AgentRuntime` contract, Claude Agent SDK adapter, scripted fake |

## Flow

```
factory new "<outcome>"
  discovery agent (read-only tools) ── one question at a time ──▶ spec
  router picks a profile ──▶ awaiting_approval ──▶ ✋ one approval (contract frozen by sha256)
  queued ──▶ claimed with a lease (SKIP LOCKED) ──▶ running
    prepare   worktree .factory/worktrees/<id> on factory/<slug>-<id>; container; install with network; network cut
    locate    git grep for the spec's terms and named paths
    implement implementer agent; file tools confined to the worktree; commands only via sandbox_exec
    verify    every check from .factory/checks or detection, in the offline container;
              up to 2 repair passes, stopping early on an identical failure
    deliver   one squashed commit; optional push + PR, each behind an idempotency key
  delivered | failed | cancelled, with .factory/runs/<id>/task.md as the readable record
```

That is the `quick` chain; the other profiles add stages (see Profiles). A user override can move to a lighter profile only for low-risk work that touches no security or data.

## Profiles

All four profiles run on the one engine; `workflows/*.yaml` lists each one's stages and budgets.

| Profile | Stages | What the extra stages do |
| --- | --- | --- |
| `quick` | locate → implement → verify → deliver | `git grep` locate; can escalate (below) |
| `bugfix` | locate → **reproduce** → implement → verify → deliver | the implementer first writes a regression test, no fix; the fix answer suggests refactors |
| `feature` | locate + **architecture** → implement → verify → **review** → deliver | import-graph brief; one independent review |
| `refactor` | locate + **architecture** → **baseline** → implement → verify → **review** → deliver | checks recorded before any change |

- **Reproduce.** The change may touch test files only (`*.test.*`, `*_test.*`, `test_*.py`, `test/`, `tests/`, `__tests__/`, fixture and snapshot directories), else the run fails. At least one check must then fail; its command and output hash are kept in `artifacts/reproduce.json`, and the test is committed before the fix. The fix resumes the same agent session and must not delete the test. If the agent answers `not_reproducible`, the run continues only when an acceptance criterion is `manual`, and the reason is recorded as a decision.
- **Suggested refactors.** A bugfix keeps the fix minimal, but its implementer may suggest up to 3 refactors that would stop the bug class recurring. They are validated (relative paths inside the repo), never applied, and shown in `artifacts/refactors.json`, `task.md`, the PR body and `factory result`, each with a ready `factory new` outcome.
- **Architecture.** `packages/index` builds an import graph of the worktree's tracked files, cached per HEAD sha. The located files become candidate modules with importer counts, paired tests, `computeImpact` dependents, packages and a recommended placement, written to `artifacts/architecture.md` and fed to the implementer. Feature and refactor implementers must answer with `placement` (location, reused modules, rationale), recorded as implementation decisions.
- **Baseline.** Every check runs before the change; the result lives in the checkpoint, so recovery never reruns it. In verify, a check that passed at baseline must pass (a failure is a regression); one that already failed is recorded and not blamed. A run where no check passes at baseline stops.
- **Review.** One read-only reviewer (`agents/reviewer.md`, fresh session, Read/Glob/Grep only) sees the spec, acceptance criteria and the committed diff against the base. Its JSON is validated: findings on files outside the diff, and over 20, are dropped, and unknown acceptance ids are stripped. The verdict is `changes` only if a blocking finding survives. Then the implementer session gets one targeted repair, the checks run once more, and any failure ends the run. There is never a second review, and recovery from a review checkpoint reuses the stored verdict. The result goes to `artifacts/review.json` and `task.md`.
- **Escalation.** After verify, a `quick` or `bugfix` run whose committed diff touches more than max(3, 2 × `estimatedFiles`) files, or files under more than one package manifest, gains a review stage. A `profile_escalated` event and a decision record it; the escalation lives in checkpoint data, so the frozen contract hash still verifies. Past max(10, 5 × `estimatedFiles`) files, or with under 25% of the wall-clock budget left, the run stops with a blocker instead.

## Auth

The agent runs the official Claude Code binary through the Agent SDK. The factory never reads or proxies credentials.

- **`FACTORY_AUTH=subscription` (default)** uses your own Claude login on this machine: the stored `/login` credential or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`. The adapter removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_USE_*` from the agent's environment, because they would outrank the login, and then checks that Claude Code really used a first-party subscription (an `agent_auth` event records it). Never use `--bare`: it ignores OAuth.
- **`FACTORY_AUTH=api-key`** uses `ANTHROPIC_API_KEY` and checks that it was used.

Anthropic does not allow third-party products to offer claude.ai login. Subscription mode is for running the factory yourself, locally, on your own account. A hosted or shared deployment must use API-key auth.

Cost figures are the runtime's estimates. On a subscription they are notional, not a bill.

## Running it

```bash
docker compose -f apps/factory/compose.yaml up -d
node apps/factory/start.mjs init --repo /path/to/repo
node apps/factory/start.mjs new "add a --version flag" --repo /path/to/repo
```

`init` builds the sandbox image, adds `.factory/` to `.git/info/exclude` and shows the detected checks. If none are detected, write `.factory/checks` (`name: command` per line, `!` for an install step); a run with no checks fails rather than delivering unverified code.

## MCP

`node apps/factory/start.mjs mcp` serves the same service as stdio MCP tools (`factory_start`, `factory_answer`, `factory_status`, `factory_read_task`, `factory_approve`, `factory_cancel`, `factory_result`) for Claude Code and Amp. Approval starts execution in a detached process that outlives the host. See [mcp.md](mcp.md).

## State and recovery

- Postgres (`FACTORY_DATABASE_URL`) is authoritative: `factory_runs`, `factory_events`, `factory_commands`, `factory_effects`, `factory_lessons`. Migrations live in `packages/factory/drizzle`, separate from lintcat's.
- `.factory/runs/<id>/` holds `task.md` (a projection, rewritten on each transition), `state.json`, `events.jsonl` and `artifacts/`. Editing `task.md` by hand never changes the run: the edit is kept as `task.user-edit.md` and a `task_md_conflict` event is recorded.
- After each stage the engine commits a checkpoint on the run branch and stores its SHA. A worker that claims an expired lease resets the worktree to the checkpoint and reruns the interrupted stage, at most 3 times.
- Branch, push and PR are recorded in `factory_effects` before or after they happen, and the PR step also asks `gh` for an existing PR first, so a retry never opens a second.
- `factory cancel` sets a flag the worker sees within one heartbeat (5 s); it aborts the agent and kills the container's processes. The worktree and branch stay.

## Telemetry

Every event carries `run_id`, `task_id`, `stage`, `agent_id`, `workflow_version`, `prompt_version`, `tool_version` and `repository_sha` where they apply. Commands record duration, exit code, error category, a normalised output hash and bounded, redacted output. Stages are OpenTelemetry spans through `@opentelemetry/api`; they go nowhere until a host registers a tracer provider. Raw prompts and file contents are not logged.

## Evaluation

`factory report` prints per-profile outcome metrics and a read-only learning report that clusters recurring failures into proposed lessons (`factory_lessons`); nothing it finds is applied or shown to an agent. `factory bench run --config benchmarks/factory/configs/baseline.json` runs four seeded fixtures through the real service and judges each delivery with hidden checks the agent never sees; `factory bench compare <a> <b>` compares two configurations. `factory prune` drops old event and command detail (`FACTORY_RETENTION_DAYS`, default 90). See [evaluation.md](evaluation.md).

## Assumptions and gaps

- The disk use of a worktree can't be capped on Docker Desktop; only the `/tmp` tmpfs is limited.
- `quick` and `bugfix` locate with `git grep` only; the import graph is built for `feature` and `refactor`.
- Amp integration is documented but unverified; see [mcp.md](mcp.md).
- See [threat-model.md](threat-model.md) for what the sandbox does and doesn't protect against.
