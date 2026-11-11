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

Only `quick` is enabled. `bugfix`, `feature` and `refactor` are defined but routing to them returns a blocker until stage 3. A user override can move to a lighter profile only for low-risk work that touches no security or data.

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

## State and recovery

- Postgres (`FACTORY_DATABASE_URL`) is authoritative: `factory_runs`, `factory_events`, `factory_commands`, `factory_effects`. Migrations live in `packages/factory/drizzle`, separate from lintcat's.
- `.factory/runs/<id>/` holds `task.md` (a projection, rewritten on each transition), `state.json`, `events.jsonl` and `artifacts/`. Editing `task.md` by hand never changes the run: the edit is kept as `task.user-edit.md` and a `task_md_conflict` event is recorded.
- After each stage the engine commits a checkpoint on the run branch and stores its SHA. A worker that claims an expired lease resets the worktree to the checkpoint and reruns the interrupted stage, at most 3 times.
- Branch, push and PR are recorded in `factory_effects` before or after they happen, and the PR step also asks `gh` for an existing PR first, so a retry never opens a second.
- `factory cancel` sets a flag the worker sees within one heartbeat (5 s); it aborts the agent and kills the container's processes. The worktree and branch stay.

## Telemetry

Every event carries `run_id`, `task_id`, `stage`, `agent_id`, `workflow_version`, `prompt_version`, `tool_version` and `repository_sha` where they apply. Commands record duration, exit code, error category, a normalised output hash and bounded, redacted output. Stages are OpenTelemetry spans through `@opentelemetry/api`; they go nowhere until a host registers a tracer provider. Raw prompts and file contents are not logged.

## Assumptions and gaps

- The disk use of a worktree can't be capped on Docker Desktop; only the `/tmp` tmpfs is limited.
- Locate uses `git grep`, not `packages/index`; the symbol and import analysis comes with the `feature` and `refactor` profiles.
- No MCP server, benchmark harness or learning report yet (stages 4–5).
- See [threat-model.md](threat-model.md) for what the sandbox does and doesn't protect against.
