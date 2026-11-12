# @pr-review/factory-cli

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
`.factory/checks` with `name: command` lines.

## Commands

| Command | What it does |
|---|---|
| `new "<outcome>" [--repo] [--profile] [--pr] [--no-run]` | Discovery Q&A, approval, then a foreground run |
| `run <id>` / `resume <id>` | Run a queued run, or recover one whose lease expired |
| `worker [--poll-ms N]` | Run queued tasks until Ctrl-C |
| `status [<id>]` | One run with its last events, or recent runs and per-profile stats |
| `logs <id> [-f]` | Events and failed command output; `-f` follows |
| `cancel <id>` | Cancel a run |
| `result <id>` | Branch, PR, checks, usage and `task.md` |

Structured logs go to `<repo>/.factory/factory.log`; the terminal shows the
readable event stream.

## Configuration

Read from the environment and this repository's `.env.local`:

| Variable | Default |
|---|---|
| `FACTORY_DATABASE_URL` | `postgres://factory:factory@127.0.0.1:54329/factory` |
| `FACTORY_AUTH` | `subscription` (or `api-key`) |
| `FACTORY_CLAUDE_PATH` | `claude` on `PATH` |
| `FACTORY_DELIVERY` | `branch` (or `pr`; `--pr` sets it per task) |

| Exit code | Meaning |
|---|---|
| 0 | Done, or delivered |
| 1 | The run failed or was cancelled |
| 2 | Usage error |
| 3 | Environment problem: Docker, database or auth |
