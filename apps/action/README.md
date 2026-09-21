# Review Agent Fleet

Reviews pull requests with one AI reviewer. Findings post as inline pull
request review comments, alongside a check run named `AI PR Review` carrying
the full summary. The model provider is configurable.

The reviewer never writes to GitHub. It is given eight read-only tools and
proposes structured findings; deterministic code then decides what actually gets
published: every finding must pass a schema check, name a file in the pull
request, anchor to a line the pull request actually added, and clear a
confidence threshold. The review is advisory and never blocks a merge.

## Usage

```yaml
name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  contents: write
  pull-requests: write
  checks: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: sunnyeyles/pr-review-action@v2
        with:
          api-key: ${{ secrets.OPENAI_API_KEY }}
```

The `closed` trigger and `contents: write` are needed only for
[`memory-branch`](#inputs); without it, `types: [opened, synchronize,
reopened]` and `contents: read` are enough.

Moving from `v1`: the `anthropic-api-key` input is now `api-key`, and
`model-provider` selects OpenAI (the default) or Anthropic.

No checkout step is needed. Everything — the pull request and the diff — is
read through the GitHub API, never from a working copy, and the code under
review is never executed.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `api-key` | yes, as the input or through `env` | — | Key for the selected provider, which the reviewer authenticates with. Store it as a secret. Falls back to that provider's own variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) when left empty. |
| `model-provider` | no | `openai` | Which provider to call: `openai` or `anthropic`. An unknown name fails the step before any model call. |
| `github-token` | no | `${{ github.token }}` | Token for the read-only tools, the review comments, and the check run. |
| `model` | no | the provider's own | Default model id, as the provider spells it: `gpt-5.6-luna` on `openai`, `claude-haiku-4-5` on `anthropic`. |
| `model-base-url` | no | the provider's own host | Overrides the provider's API host — a gateway, a proxy, or a compatible endpoint (for `openai`, one that accepts `max_completion_tokens`). |
| `index` | no | `true` | Whether the review builds a repository index from the pull request's base commit before the reviewer starts. One archive request, `contents: read` only, held in memory and discarded. Any failure is logged and the review runs without it. `false` turns it off. |
| `fix` | no | `false` | Whether verified fixes are committed to the pull request branch. `true` turns it on; any other value leaves it off. Needs `contents: write`. Off, or when the commit cannot be made, the same fixes are offered as suggested changes on the review comments. |
| `memory-branch` | no | — | Branch the action stores its review memory on: one JSON file recording what this repository did with each past finding, so repeatedly ignored shapes are deprioritised in later reviews. Empty turns the feature off. Needs `contents: write` and `closed` in the workflow's `types`. |
| `langfuse-public-key` | no | — | Langfuse public key. Set this and the secret key to manage prompts and collect traces. |
| `langfuse-secret-key` | no | — | Langfuse secret key. Store it as a secret. |
| `langfuse-base-url` | no | `https://cloud.langfuse.com` | Langfuse host, for self-hosted instances. |
| `langfuse-prompt-label` | no | `production` | Which labelled version of each prompt to fetch. |
| `dashboard-token` | no | — | Ingest secret for the review dashboard. Set this and `dashboard-url` to record each review there. Store it as a secret. |
| `dashboard-url` | no | — | Dashboard base URL, e.g. `https://example.vercel.app`; the action appends `/api/ingest`. |

## Repository index

With `index` on, the review fetches your repository's files at the pull
request's **base** commit in one archive request and builds an index of them in
memory before the reviewer starts. Never the head commit: a pull request must not
shape what the reviewer believes about the repository. Nothing is stored, no
service runs, and `contents: read` is the only permission it needs.

The index holds each file's role, which test covers which source file by naming
convention, and an import graph of every TypeScript and JavaScript `import`,
`export … from`, dynamic `import()` and `require()`. Specifiers resolve the way
your own tooling resolves them, in order: a relative path (extensionless,
through `index` files, `.js` to the `.ts` behind it), a `#` import map, a
`tsconfig.json` `paths` alias with `extends` followed, then a workspace package
name through its `exports` map. Workspace packages come from
`pnpm-workspace.yaml` or `package.json` `workspaces`. A third-party package is
left unresolved rather than guessed, and a manifest too malformed to read costs
that file's contribution, not the build. Only TypeScript and JavaScript are
parsed — every other language is seen for its role and reported as not indexed.

The reviewer reads it through `find_references(path, name?)`: the files importing a
path, with lines, and optionally only those importing one exported name. Every
result names the commit it covers, whether the index is truncated, and each
indexed language's **resolution rate** — the share of your repository's own
imports the index could place — so an empty answer is never mistaken for
"nothing depends on this", and an alias scheme this resolver does not
understand is visible rather than silent. The opening message gets a
`<repository>` block listing your workspace packages with their roots, and one
line per changed file with its package, role, covering test and importer count.

Reading the archive is capped, and hitting a cap marks the index truncated
rather than failing. Any failure at all is logged and the review runs without
the index.

## Model providers

The action is provider-agnostic: `model-provider` picks the adapter, `api-key`
carries that provider's key, and `model` names the model as that provider
spells it.

```yaml
        with:
          model-provider: anthropic
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          model: claude-sonnet-5
```

`model-base-url` points the selected adapter somewhere else — an Azure
deployment, a gateway, or a self-hosted server speaking that provider's API.

Prompt caching is requested on `anthropic` only — it is the provider whose API
takes explicit cache breakpoints. On `openai` nothing is requested and
`cacheCreationInputTokens` / `cacheReadInputTokens` stay at zero, which is
expected rather than a fault.

## Langfuse (optional)

Leave the Langfuse inputs unset and the action runs on the system prompts built
into it, exporting nothing. That is the default and needs no account.

Supply **both** keys and two things change: the system prompt is fetched from
Langfuse at the start of the run (as `general_system`), and the reviewer and its
tool calls export traces.

Neither is load-bearing. If Langfuse is unreachable, slow, missing a prompt, or
returns text that has lost its output contract, that prompt falls back to the
built-in one and the review proceeds — per prompt, so one bad entry costs one
prompt rather than the run. Setting only one of the two keys disables both
features and logs `langfuse.disabled_incomplete_credentials`.

## Review dashboard (optional)

Leave both dashboard inputs unset and the review is published to GitHub only.
That is the default and needs nothing hosted.

Supply **both** and each finished review is also POSTed to
`<dashboard-url>/api/ingest`, authenticated with `dashboard-token` as a bearer
token: a one-line summary, the run's duration, its four token counters, and
every published finding.

```yaml
        with:
          api-key: ${{ secrets.OPENAI_API_KEY }}
          dashboard-url: https://example.vercel.app
          dashboard-token: ${{ secrets.PR_REVIEW_DASHBOARD_TOKEN }}
```

The report is not load-bearing. A dashboard that is unreachable, slow, or
rejects the record logs `dashboard.publish_failed` and the review still passes
— the step's exit code never depends on it. Setting only one of the two inputs
records nothing and logs `dashboard.disabled_incomplete_config`.

## Permissions

Every one of them degrades rather than fails, except the first.

| Permission | With it | Without it |
| --- | --- | --- |
| `contents: read` | Reads files at the head and base commits | The action cannot run |
| `pull-requests: write` | Findings post as inline review comments | The check run annotates the same lines instead, and logs `review.comments.degraded` |
| `checks: write` | Publishes the `AI PR Review` check run and its annotations | The whole review is written to the workflow job summary instead, and logs `review.published.degraded` |
| `contents: write` | Commits verified fixes to the pull request branch, when `fix: true` | The same fixes are offered as suggested changes, and it logs `review.fixes.degraded` |

**Fork pull requests.** GitHub gives a fork-triggered workflow a read-only
token, so both degradations fire at once and the review lands in the job
summary. The step still exits 0. Findings keep their file and line; only the
inline placement is lost.

## What it does not do

No automatic fixing, no automatic merging or approval, and no review history.
Without `memory-branch` it keeps no memory between runs and writes nothing
beyond the check run and its comments.
