# Factory MCP server

`factory mcp` serves the factory as MCP tools over stdio, so a coding host (Claude Code, Amp) can start, approve and inspect runs. It is a thin client of the same factory service the CLI uses (`apps/factory/src/mcp-server.ts`), and it writes nothing to stdout except the protocol.

## Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `factory_start` | `repoPath?`, exactly one of `outcome` / `spec`, `profile?`, `pullRequest?` | With `outcome`: records a `draft` run and runs **one** discovery turn, returning a question or a proposed spec. With `spec` (validated by `specSchema`): records it as `awaiting_approval`. Returns the run id. |
| `factory_answer` | `runId`, `answer` | Answers the pending discovery question, or, after a proposal, revises the spec with this feedback (at most 3 revisions). One discovery turn per call. |
| `factory_status` | `runId?`, `repoPath?` | A run's status, stage, blocker, pending question and last 10 events; without `runId`, the 20 most recent runs. Read-only. |
| `factory_read_task` | `runId` | `.factory/runs/<id>/task.md`; before execution writes it, rendered from the proposed spec. Read-only. |
| `factory_approve` | `runId` | The single approval: freezes the contract, queues the run, starts execution outside the server, returns at once. |
| `factory_cancel` | `runId` | Cancels a run or discards a discovery draft. |
| `factory_result` | `runId` | Branch, PR, check results, implementation decisions, every command (exit code, duration), duration, attempts, recoveries and usage. Read-only. |

Every tool returns a short text summary plus `structuredContent`. Errors (unknown run id, wrong state, invalid spec) come back as tool errors (`isError: true`) with a message the host model can act on.

### Discovery over MCP

Discovery is a conversation, and an MCP tool call is one request. So the server runs discovery turn by turn: each `factory_start`/`factory_answer` resumes the same discovery agent session for one turn and returns. Between calls the state (agent session id, question and revision counts, pending question) lives in `.factory/runs/<id>/discovery.json`, which is git-ignored with the rest of `.factory/`. The run row exists from the first turn as a `draft` with a placeholder spec that cannot be approved or frozen. The first proposal replaces it and moves the run to `awaiting_approval`. The CLI's interactive `factory new` runs on the same `discoveryStep` function.

A discovery turn holds its tool call open while the agent reads the repository (read-only tools), usually tens of seconds. Nothing longer ever does.

### Execution survives the host

`factory_approve` never runs the coding agent inside the MCP server. After approving it spawns `factory run <id>` with `detached: true` (its own process group), stdio appended to `<repo>/.factory/factory.log`, then `unref()`s it and returns the pid. Closing the host, or the host killing the server's process group, does not reach that child. If the child dies, the run's lease expires and `factory resume <id>` or a `factory worker` recovers it from its checkpoint.

Set `FACTORY_MCP_EXECUTION=worker` to spawn nothing and leave approved runs to a `factory worker` you keep running. Either way the store's lease (`SELECT … FOR UPDATE SKIP LOCKED`) means a run executes once, even if a worker and a detached child both try.

Before approving, the server checks that `claude` is on `PATH` and Docker is running, so an approval never queues a run that cannot start.

## Auth model

The server speaks **stdio only**. There is no network listener, so there is nothing to authenticate over the network: the host spawns `factory mcp` as a child process, as the local user, and the server has exactly that user's access (the factory database URL, the repositories, the local Claude login). This is the MCP spec's model for stdio transports, which take credentials from the environment rather than from MCP authorization.

The discovery agent and the detached run use the same auth as the CLI (`FACTORY_AUTH`, subscription by default; see [README.md](README.md#auth)). The server never reads, copies or forwards credentials, and the host's own model key is never used.

A networked deployment (Streamable HTTP) would need MCP authorization (OAuth 2.1 with protected-resource metadata) and API-key auth for the agent, since subscription auth is for running the factory yourself. That is out of scope for the MVP.

Approval is a human decision. The tool descriptions tell the host model to call `factory_approve` only after the user has explicitly approved the spec, and Claude Code asks the user before calling an MCP tool that isn't allow-listed (Amp's per-tool behaviour for local servers is not documented and was not checked). Don't allow-list `factory_approve`.

## Setup

Postgres must be running and migrated (`docker compose -f apps/factory/compose.yaml up -d`, then `factory init`). Use absolute paths below. `node …/start.mjs` bundles on each start, so the first call takes a second or two longer.

### Claude Code (verified)

```bash
claude mcp add factory --scope user -- node /abs/path/to/apps/factory/start.mjs mcp
```

Or per invocation, with a config file:

```json
{ "mcpServers": { "factory": { "command": "node", "args": ["/abs/path/to/apps/factory/start.mjs", "mcp"] } } }
```

```bash
claude -p --strict-mcp-config --mcp-config mcp.json --allowedTools mcp__factory__factory_start mcp__factory__factory_status "…"
```

Add `"env": { "FACTORY_DATABASE_URL": "…" }` to the server entry if Postgres is not on the default `127.0.0.1:54329`.

### Amp (UNVERIFIED)

Written from the current Amp docs ([MCP](https://ampcode.com/docs/customize/mcp), [execute mode](https://ampcode.com/docs/cli/execute-mode), checked 2026-11-12). Amp was not installed on the test machine, so none of this has been run.

In `~/.config/amp/settings.json` (user scope, needs no approval; `.amp/settings.json` in a workspace needs `amp mcp approve factory`):

```json
{
  "amp.mcpServers": {
    "factory": { "command": "node", "args": ["/abs/path/to/apps/factory/start.mjs", "mcp"] }
  }
}
```

Or `amp mcp add factory -- node /abs/path/to/apps/factory/start.mjs mcp`, and `amp mcp doctor` to see whether it connected.

What the docs don't settle, and so is untested: whether Amp shows the server's `instructions`, uses `structuredContent` from a local server (the text summary alone is enough to drive the flow), and whether it times out a long discovery turn.

## Smoke tests

None of these run in `pnpm test`.

| Test | Command | Result (2026-11-12) |
| --- | --- | --- |
| In-process protocol, fake agent (in `pnpm test`) | `pnpm vitest run apps/factory/src/mcp-server.test.ts` | Pass: spec start, turn-based discovery (question, answer, proposal, revision), approve launches once and returns, cancel, result, invalid spec, unknown id |
| Real stdio process, no model | `node apps/factory/scripts/mcp-smoke.mjs [scratch-dir]` | Pass: 7 tools listed; start with spec, status `awaiting_approval`, read task, cancel, unknown id |
| Claude Code host | `apps/factory/scripts/mcp-host-smoke.sh claude [scratch-dir]` | **Verified.** `claude -p` (Claude Code 2.1.322) spawned the server, called `factory_start` with the spec and `factory_status`, replied `RUN <id> awaiting_approval`; `factory status` showed the same run independently |
| Amp host | `apps/factory/scripts/mcp-host-smoke.sh amp [scratch-dir]` | **UNVERIFIED**: Amp not installed. The script uses `amp --dangerously-allow-all --mcp-config '{"factory":{…}}' -x "<prompt>"`; pass if Amp prints `RUN <id> awaiting_approval` and `factory status` lists the run |

Not verified end to end: a real coding run started from `factory_approve` and finishing after the host exits. The detached spawn (`run <id>`, cwd, log file) is unit-tested in `apps/factory/src/mcp.test.ts`; the run itself is the same `factory run` the CLI uses.
