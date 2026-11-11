# Factory threat model

The factory runs a model over a repository it doesn't fully trust, and runs that repository's code. These are the threats and what stands between them and the host.

## Trust boundaries

| Component | Runs where | Holds |
| --- | --- | --- |
| Orchestrator, store, git | Host | Database URL, git identity, `gh` login |
| Claude Code (agent) | Host, as a child process | Your Claude login, through Claude Code itself |
| Repository code: tests, installs, scripts | Docker container | Nothing secret |

The agent has no shell. Its only tools are Read, Glob, Grep, Edit and Write, confined to the run's worktree, plus `sandbox_exec`, which runs in the container.

## Threats

**Prompt injection in repository files.** A file can tell the agent to do something else. Mitigations:
- The agent can't reach the network, credentials or the host's shell.
- A PreToolUse hook and the permission callback deny any file path outside the worktree (symlinks resolved) and any path inside `.git`.
- `settingSources: []` and `strictMcpConfig` stop the target repo's `.claude/settings.json` hooks and `.mcp.json` servers from running on the host.
- The approved contract is hashed; the agent can append implementation decisions but can't change requirements or acceptance criteria.
- Every check is rerun by the orchestrator. The agent's own claims are not evidence.

What remains: the agent can write bad code into the branch. Delivery never merges, and a person reviews the branch or PR.

**Malicious dependencies or install scripts.** Install runs in the container with network, before any agent-written code exists. Then the network is disconnected, and that is verified, before anything else runs. A malicious `postinstall` still runs with network access during setup. It can't read host files or credentials, but it can poison `node_modules` in the worktree for later offline steps.

**Secret exfiltration.** The container gets no environment from the host and mounts only the worktree. Command output is bounded and redacted before it is stored. The agent's environment has `DATABASE_URL`, `FACTORY_DATABASE_URL`, `GITHUB_TOKEN` and `GH_TOKEN` removed. Secrets committed in the repository itself are visible to the agent and to the model provider, the same as when using Claude Code by hand.

**Untrusted code execution.** The container runs:
- as your uid, never root, with every capability dropped and `no-new-privileges`
- with a read-only root filesystem and a size-limited tmpfs
- with limits on pids, memory (no swap) and CPU, and a per-command timeout
- with a whole-run wall-clock budget

No Docker socket is mounted.

**Escalation through git.** Only the host runs git. Pushing refuses `main`, `master` and the remote's default branch, never forces, and happens only when the approved contract permits it.

## Docker is not a hostile-code boundary

Containers share the host kernel. A kernel or Docker Desktop escape defeats every limit above. This is acceptable for repositories you'd run locally anyway: your own code and its dependencies.

For untrusted third-party repositories, or several tenants on one host, use stronger isolation: gVisor (`runsc`), Kata Containers, or Firecracker microVMs, or one VM per run. Only the `SandboxProvider` implementation needs to change.

Disk quotas on the bind-mounted worktree are not enforced on Docker Desktop.
