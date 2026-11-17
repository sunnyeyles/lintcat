# @pr-review/factory

`factory` turns a described outcome into an approved spec, then implements it
in a Docker sandbox and delivers a branch (or a pull request).

## Prerequisites

- Docker, running
- Node 24
- Claude Code: a logged-in `claude` on `PATH`, or `CLAUDE_CODE_OAUTH_TOKEN`
  (`FACTORY_AUTH=api-key` uses `ANTHROPIC_API_KEY` instead)
- `gh`, logged in, only for `--pr` delivery

## Setup

```sh
docker compose -f apps/factory/compose.yaml up -d
node apps/factory/start.mjs init --repo /path/to/repo
```

`init` builds the sandbox image, git-ignores `.factory/`, shows the checks it
detected and migrates the database. With no checks detected, add
`.factory/checks` with `name: command` lines (`!` for an install step). A run
with no checks fails rather than delivering unverified code.

## Commands

| Command | What it does |
|---|---|
| `init [--repo]` | Check Docker and the database, build the sandbox image |
| `new "<outcome>" [--repo] [--profile] [--pr] [--no-run]` | Discovery Q&A, approval, then a foreground run |
| `run <id>` | Run a queued run, or recover one whose lease expired |
| `worker [--poll-ms N]` | Run queued tasks until Ctrl-C |
| `status [<id>]` | One run with its last events, or recent runs and per-profile counts |
| `logs <id> [-f]` | Events and failed command output; `-f` follows |
| `cancel <id>` | Cancel a run |
| `result <id>` | Branch, PR, checks, usage and `task.md` |
| `report [--json] [--repo] [--since-days N]` | Per-profile outcome metrics ([evaluation.md](docs/evaluation.md)) |
| `prune [--days N]` | Drop old runs' events and commands |

Structured logs go to `<repo>/.factory/factory.log`; the terminal shows the
readable event stream.

## Flow

```
new "<outcome>"
  discovery agent (read-only) ── one question at a time ──▶ spec
  spec review (not quick): a fresh read-only agent paraphrases and audits it;
    discovery fixes, contests or escalates findings; one re-audit
  routed to a profile ──▶ awaiting_approval ──▶ one approval (contract frozen by sha256)
  queued ──▶ claimed with a lease ──▶ running
    prepare    worktree on factory/<slug>-<id>; container; install with network; network cut
    locate     git grep for the spec's terms and named paths
    implement  file tools confined to the worktree; commands only via sandbox_exec
    verify     every check in the offline container, with repair passes
    deliver    one squashed commit; optional push + PR, each behind an idempotency key
  delivered | failed | cancelled, with .factory/runs/<id>/task.md as the record
```

| Profile | Extra stages |
|---|---|
| `quick` | none |
| `bugfix` | **reproduce**: a failing regression test, committed before the fix |
| `feature` | **review**: one independent read-only review, at most one repair |
| `refactor` | **baseline** checks before any change, then **review** |

The spec reviewer sees only the spec and the repository, as the implementer
will. You approve with its paraphrase and any open or escalated findings beside
the spec; they inform the decision and never block it. Each review is a
`spec_reviewed` event.

Profiles live in `src/engine/profiles.ts`. Postgres is authoritative; a worker
that claims an expired lease resumes from the last checkpoint, at most 3 times.

## Cast

![The factory cast](assets/characters/cast.png)

`scripts/characters.mjs` draws four characters as sprite sheets (8 frames of
120×120 across, `idle` on the top row, `active` on the bottom) into
`apps/web/public/factory-cast/`, and the preview above. The Factory trace shows
them for a run's stages and agents, the running one on its `active` row.
Regenerate with `node apps/factory/scripts/characters.mjs`; the output is
byte-identical on every run.

| Sheet | Stages | Active animation |
|---|---|---|
| `locate.png` | locate, architecture | radar sweeps, flashlight on, map pin hops |
| `implementer.png` | reproduce, implement | wrench waves, torch sparks, treads roll |
| `verify.png` | baseline, verify, review | stamps, checklist ticks off, lamp blinks |
| `deliver.png` | deliver | crate lifts, beacon flashes, wheels turn |

## Auth

The agent runs the official Claude Code binary through the Agent SDK; the
factory never reads or proxies credentials.

- `FACTORY_AUTH=subscription` (default) uses your own Claude login. The adapter
  strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and
  `CLAUDE_CODE_USE_*` from the agent's environment, then checks that a
  first-party subscription was used.
- `FACTORY_AUTH=api-key` uses `ANTHROPIC_API_KEY`.

Subscription mode is for running the factory yourself, on your own account. A
hosted or shared deployment must use API-key auth. Cost figures are the
runtime's estimates; on a subscription they are notional.

See [threat-model.md](docs/threat-model.md) for what the sandbox does and
doesn't protect against.

## Configuration

Read from the environment and this repository's `.env.local`:

| Variable | Default |
|---|---|
| `FACTORY_DATABASE_URL` | `postgres://factory:factory@127.0.0.1:54329/factory` |
| `FACTORY_AUTH` | `subscription` (or `api-key`) |
| `FACTORY_CLAUDE_PATH` | `claude` on `PATH` |
| `FACTORY_DELIVERY` | `branch` (or `pr`; `--pr` sets it per task) |
| `FACTORY_RETENTION_DAYS` | `90`, for `prune` |

| Exit code | Meaning |
|---|---|
| 0 | Done, or delivered |
| 1 | The run failed or was cancelled |
| 2 | Usage error |
| 3 | Environment problem: Docker, database or auth |
