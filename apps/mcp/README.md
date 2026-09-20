# @pr-review/mcp

A local stdio MCP server that exposes the reviewer to an agent such as Claude
Code: review your working tree before you push, dry-run a pull request review,
navigate the import index, and read the dashboard's review history.

## Use it from Claude Code

The repository's `.mcp.json` registers it as `pr-review`. Claude Code asks
you to approve it the first time. `node apps/mcp/start.mjs` rebuilds the bundle
before every start, so no build step is needed. For another repository, run
`claude mcp add pr-review -- node /path/to/pr-review-agents/apps/mcp/start.mjs`.
Then pass that repository's checkout as `repoPath`, or start Claude Code in it.

## Tools

| Tool | What it does | Needs |
|---|---|---|
| `review_local_changes` | Runs the configured agents on commits since the merge-base with the base branch, plus uncommitted and untracked files. Returns only validated findings. | A model key |
| `review_pull_request` | Reviews a GitHub PR at its head. It is a dry run unless `publish: true`, which posts the check run and review comments. It never commits fixes. | A model key and a GitHub token |
| `repository_overview` | Lists the workspace's packages and the per-language index coverage. | Nothing |
| `find_references` | Lists the files that import a file, or one of its exported names. Same query, cap and result shape as the review agents' tool. | Nothing |
| `describe_file` | Shows a file's role, package, importers, covering test, and imports. | Nothing |
| `list_reviews`, `get_review`, `review_trends` | Stored reviews, findings, trends and cost. | `DATABASE_URL` and a GitHub token |

A local review reads the agent configuration (`.github/pr-review-agents.yml`)
at the base commit, the same way the Action does. It then goes through the same
`reviewPullRequest` path, using a git-backed client in place of GitHub's. The
index tools read the working tree and cache the index until it changes.

History uses the dashboard's own access rules (`authorize` in `packages/db`).
Your GitHub account must be a member of the organization, and private repos
need a `repo_access` row.

## Configuration

The server loads the nearest `.env.local` above its working directory. A
variable that is already set takes precedence.

| Variable | Default |
|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | One is required for reviews |
| `PR_REVIEW_MODEL_PROVIDER` | `openai` when its key is set, otherwise whichever provider has a key |
| `PR_REVIEW_MODEL` | The provider's default. Haiku is weak here, so prefer `claude-sonnet-5` |
| `PR_REVIEW_MODEL_BASE_URL` | Unset |
| `GITHUB_TOKEN` / `GH_TOKEN` | Falls back to `gh auth token` |
| `DATABASE_URL` | From `.env.local` |

Logs go to stderr, because stdout carries the protocol.

## Distribution

This is a stdio server for people who have this repository checked out. To
ship it to anyone else, package the bundle (`pnpm build` → `dist/index.mjs`)
as an [MCP Bundle](https://github.com/modelcontextprotocol/mcpb).
