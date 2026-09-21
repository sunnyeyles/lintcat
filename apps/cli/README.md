# @pr-review/cli

`pr-review` runs the reviewer over a local checkout from the command line —
no MCP client, no pull request. It is the same path
[`apps/mcp`](../mcp) serves to a coding agent: a git-backed client in place of
GitHub's, the agent configuration read at the base commit, and only findings
that passed `validateFindings()` printed. Nothing reaches your terminal that
would not have reached a pull request.

```sh
node apps/cli/start.mjs review          # this checkout, against its base branch
node apps/cli/start.mjs install-hook    # block a push that carries a high finding
```

`start.mjs` rebuilds the bundle (about 150ms) before every run, so the command
never reviews with stale code. Inside this repository `pnpm exec pr-review`
resolves to the same entry point.

## Reviewing

`review` is the command when none is named. By default it reviews the working
tree: the commits since the merge-base with the base branch, plus uncommitted
and untracked files.

| Option | What it does |
|---|---|
| `--repo <path>` | The checkout to review; defaults to the working directory |
| `--base <ref>` | What to compare against; defaults to the remote default branch |
| `--scope <kind>` | `working-tree` (default), `staged`, or `range` |
| `--range <range>` | `HEAD~3..HEAD`, `main...feature` or a single commit; implies `--scope range` |
| `--agents <list>` | Comma-separated categories, e.g. `security,correctness`; defaults to the repository's configured set |
| `--fail-on <level>` | The severity that fails the command: `low`, `medium`, `high` (default) or `off` |
| `--no-index` | Skip the repository import index |
| `--no-progress` | Do not report each agent starting and finishing |
| `--verbose` | Let the review's structured log through to stderr |
| `--color` / `--no-color` | Force colour; otherwise it follows the terminal and `NO_COLOR` |

Findings go to stdout, one location per finding, severity first. Everything
else — progress, the line naming what was reviewed, errors — goes to stderr, so
`pr-review review > findings.txt` keeps the two apart.

| Exit code | Meaning |
|---|---|
| `0` | No finding at or above `--fail-on` |
| `1` | At least one finding at or above `--fail-on` |
| `2` | The review could not run: a missing key, a bad ref, a bad option |
| `3` | The review was cancelled by Ctrl-C or `SIGTERM`; no verdict was reached |

The first interrupt cancels the review's in-flight model calls rather than
abandoning them, so the provider stops generating. A second interrupt quits at
once with `130` (`143` for `SIGTERM`).

A missing model API key is reported before any git or model work begins. Set
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the environment, or in this
project's `.env.local`.

## The pre-push hook

`install-hook` writes `.git/hooks/pre-push` (or wherever `core.hooksPath`
points) into the checkout. The hook runs the review and blocks the push when
anything at or above its severity is found. A review cancelled with Ctrl-C also
refuses the push, but the hook says it was cancelled rather than blocked.

```sh
node apps/cli/start.mjs install-hook --repo ~/code/some-project --fail-on high
```

| Option | What it does |
|---|---|
| `--repo <path>` | The checkout to install into; defaults to the working directory |
| `--fail-on <level>` | The severity the hook blocks on; `high` by default |
| `--command <command>` | What the hook runs; defaults to the command line that installed it |
| `--force` | Replace a `pre-push` hook `pr-review` did not write |

Re-running `install-hook` upgrades a hook this command wrote. A hook written by
anything else is never overwritten without `--force`; the error tells you the
line to add to the hook you already have.

### Bypassing it

Without editing the hook:

```sh
PR_REVIEW_SKIP=1 git push      # skips the review, pushes
git push --no-verify           # skips every pre-push hook
```

`PR_REVIEW_SKIP` is read by the hook itself, which exits before the review
starts — so a bypassed push costs nothing and calls no model.
