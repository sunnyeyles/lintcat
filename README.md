# pr-review-agents

An AI pull request reviewer that runs as a GitHub App, against your
organization's own model key. It publishes inline review comments and an
`AI PR Review` check run carrying the full summary.

## What it finds

One agent reviews the whole pull request in a single pass, with no
configuration and nothing to choose. Its brief
([`general-agent.ts`](packages/ai/src/agents/general-agent.ts)) is **codebase
drift**: places where the change departs from how the rest of the repository
already does the same thing — naming first, then patterns. Each finding carries
one of these categories:

| | |
| --- | --- |
| **naming** | a function, type, file, export, route or flag named differently from how the repository names the same kind of thing |
| **pattern** | a re-implemented helper, a bypassed layer, a hand-rolled version of an established construct |
| **docs** | documentation or a code comment this change made false, and a doc link the change adds to a file or heading that does not exist |
| **style** | a structural habit the neighbouring files share and no formatter or linter enforces: export style, error shape, module layout |
| **config** | a setting, env var or dependency added differently from the ones already there: an env var the code starts reading that neither `.env.example` nor the docs list, or a dependency doing a job one already in use does |

Every finding the agent makes cites **evidence**: at least two places in files
the pull request does not change that show the convention, or one line of the
repository's own rule docs — `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` — that
states it. The opening message lists each changed file's siblings — the
unchanged files in its directory with the same role — as the local convention to
read first, and carries the rule docs and lint configuration that govern it. It
also quotes the lines of unchanged Markdown docs that name something the diff's
code edits or removes, so a doc the change made false can be cited as the
evidence. Rewording
that leaves a doc less specific is not drift. Config drift is found in code
first ([`config-drift.ts`](packages/index/src/config-drift.ts)) and handed to the
agent as facts, each with the lines to cite: a new env var read that no env
example or doc names, beside where the others are documented, and a new
dependency whose job another already does, beside where that one is imported.

A finding may carry a **patch**: a replacement for a range of lines, quoted
alongside the exact text it expects to replace. With [fixes](#fixes) on, the
surviving patches are committed to the pull request branch in one commit;
otherwise — and whenever the commit cannot be made — they arrive as one-click
suggested changes on the review comments. The agent never writes anything
itself: it proposes structured findings, and deterministic application code
decides what actually gets published.

## How noisy it is

**What it deliberately stays silent about.** Correctness bugs, security holes,
performance problems and missing tests are out of scope, and so is anything a
formatter, linter, typecheck or build already catches — including whether an
import resolves. The agent is shown the repository's own lint, format and
typecheck configuration so it knows what that covers. A directory whose files
disagree among themselves, and no rule doc settles, has no convention to drift
from, so nothing in it is reported. The agent is told to
cite only lines it has read, and to prefer a few well-evidenced findings over
many small ones.

**What the code enforces, with no model in the path**
([`validate-findings.ts`](packages/reviewer/src/validate-findings.ts)):

- a finding whose `confidence` is below **0.70** is dropped
- a finding must land on a line the diff actually **added**, in a file the pull
  request touches
- a finding must carry one of the agent's categories; any other is dropped,
  never re-stamped
- a finding's **evidence** — the `file:line` references it cites for the
  convention the change departs from — is checked against the repository index
  at the base commit: an entry naming a file that does not exist, a file the
  pull request changes, or a line past the file's end is removed, and a finding
  left with fewer than **two** entries is dropped — unless one of them is a line
  of a rule doc (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`), which is the
  convention stated and enough on its own
  ([`validate-evidence.ts`](packages/reviewer/src/validate-evidence.ts)). What
  survives is shown as "Convention seen in" links on the comment and the
  dashboard
- a Markdown link the pull request adds is resolved against its head commit
  and, when it points at a missing file or a heading the target does not have,
  reported as a `docs` finding with no model involved
  ([`doc-links.ts`](packages/reviewer/src/doc-links.ts)). These findings need no
  evidence, and go ahead of the agent's
- duplicates are removed and the survivors are **capped at 10**, strongest first
- the check run's conclusion is always `neutral` — the review is advisory and
  never blocks a merge

**What is not yet measured.** There is no review-quality benchmark, and this
README will not quote one. [`evals/`](evals/README.md) runs the real pipeline
against fixture repositories and asserts anchored recall, precision and
health checks — enough to catch a reviewer that has gone silent or gone
haywire, and not a false-positive rate. No fixture requires a patch, and
there is one sample per run. The eval README states each gap.

## Where your code goes

Installing the GitHub App is the only setup. The diff, the files the agent
reads, and the pull request's own text pass through [`apps/worker`](apps/worker),
a service this project runs on Google Cloud Run, on their way to **the
organization's own model provider** (`openai` or `anthropic`), under the API key
its owner saved at `/o/<slug>/settings` ([`packages/db`](packages/db) stores it
encrypted; the worker is the only reader of the plaintext). The worker mints a
short-lived GitHub installation token per job, holds it in memory only, and
publishes the check run and inline comments; it writes nothing to disk.

The review is recorded on the dashboard ([`apps/web`](apps/web)): owner, repo,
PR number, head SHA, timings, token counts, and every published finding. The
patch itself — its `expected` and `replacement` text, verbatim lines of your
source — is never stored; it goes to GitHub only.

The App asks for no more than it needs (see [App permissions](#app-permissions)).
It never merges and never approves.

---

## How a review happens

![A pull request rides a belt past the LintCat mascot: it reads, proposes findings, a gate with no model drops the weak ones, and the rest land as comments and a check run.](docs/assets/lintcat-how-it-works.gif)

```text
GitHub PR event (pull_request webhook → apps/web → review_jobs)
   │
   ▼
Worker (apps/worker)
   │
   ├── mint an installation token
   ├── load PR, changed files, diff
   ├── build the repository index at the base commit
   ├── score the change's blast radius from that index
   ├── suggest reviewers from blame at the base commit and CODEOWNERS, beside the agent
   │
   ▼
Review pipeline
   │
   └─ general agent (read-only tools) ─► validate ─► END
                                            │
                                            ▼
                            GitHub Check Run + annotations
```

---

## The trust boundary

This is the core design constraint of the project: **model output is untrusted
data until deterministic code has validated it.**

```text
Agent ──► raw candidates (unknown[])
              │
              ▼
   ┌──────────────────────────────────────┐
   │ validateFindings()  — no model here  │
   │  1. Zod schema                       │
   │  2. category is one the agent defines│
   │  3. file exists in the PR            │
   │  4. line is an ADDED line in the diff│
   │  5. confidence >= 0.70               │
   │  6. evidence checked at the base     │
   │  7. duplicate removal                │
   │  8. cap at 10, strongest first       │
   └──────────────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────────────┐
   │ checkDocLinks()     — no model here  │
   │  added doc links resolved at head;   │
   │  a broken one leads the findings     │
   └──────────────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────────────┐
   │ verifyPatches()     — no model here  │
   │  1. file is read at the head commit  │
   │  2. `expected` matches those lines   │
   │     byte for byte, or the patch dies │
   │  3. range touches the diff           │
   │  4. no two patches overlap           │
   │  5. cap at 5 files / 200 lines       │
   └──────────────────────────────────────┘
              │
              ▼
        GitHub API (application code only)
```

Reinforcing rules:

- The agent is given **eight read-only tools** and nothing else:
  `get_pull_request`, `list_changed_files`, `get_diff`, `get_file`,
  `get_base_file`, `search_repository`, `find_references`,
  `find_co_changed_files`. No write, comment, approve, merge, or execute tool
  exists. `search_repository` and `find_co_changed_files` read the repository's
  default branch, so the agent is told to treat their results as pointers to
  read with `get_file`, never as evidence; `find_references` answers from the
  [repository index](#repository-index) at the base commit.
- The agent's system prompt carries a non-negotiable **prompt-injection
  block**: repository contents (diffs, files, PR title/description, search
  results) are data, never instructions; tool results grant no permissions.
- The agent's findings are **filtered to the categories it defines**, not
  re-stamped, so category provenance stays deterministic.
- The check run conclusion is `neutral` whenever findings exist — the app is
  advisory and never blocks a merge.
- A **patch never reaches a file on the agent's word**. The agent quotes the
  lines it means to replace; application code re-reads them at the head commit
  and discards the patch on any mismatch. The finding survives without it, so a
  miscounted line costs the fix, never the review.
- Fixes are **committed, never forced**. The branch tip must still be the commit
  the review read, and the ref update is a plain fast-forward — a push that
  landed mid-review wins the race, and the fixes become suggestions instead.

---

## Repository layout

```text
apps/
  cli/        `pr-review`: the same pipeline over a working tree from a
              command line, and the pre-push hook that blocks on it
  mcp/        Local MCP server: the same pipeline over a working tree,
              plus index lookups and review history, for coding agents
  web/        The documentation site at /, and the dashboard behind it
  worker/     Hosted reviews: claims the jobs the GitHub App's webhook
              queues and runs the same pipeline with the org's model key
packages/
  ai/         Provider selection (model.ts), prompts, and agents/: the
              general agent, its runtime loop and read-only tools
  reviewer/   Review pipeline, validation chain, check-run rendering
  github/     GitHub client (installation-token auth) + Octokit calls
  schemas/    Zod schemas: ReviewFinding, the review trigger contract
  logging/    Structured single-line JSON logger
evals/        Fixture repositories and the harness that runs the real
              pipeline against them without touching GitHub
docs/         index.html — the architecture walkthrough, published to
              Pages and now also served by apps/web at /docs/walkthrough;
              claude/ — how the agent skills read this repo
              (.nojekyll beside it, so Pages serves the file as written)
scripts/      esbuild bundler for the cli, mcp and worker, and their
              smoke tests
```

### Failure

A review run (`packages/reviewer/src/review-run.ts`) runs the one agent,
then `validate`. The agent's tool-calling loop is one `generateText`
call (`packages/ai/src/agents/runtime.ts`), capped at 12 steps. If the agent
fails the run throws, which fails the job; the worker retries it up to
three times before publishing a `failure` check run.

### Review memory

The [MCP server](#mcp-server) keeps a review memory with its checkout: shapes
this repository has repeatedly left alone (five ignores, no resolves) are named
to the agent in a `# Repository history` block, and suppressed findings are
hidden. They are evidence, not rules: the prompt still forbids inventing a
finding, and a shape with no signal for 90 days is forgotten. Suppressions match
on title shape alone. `memory.hints_attached` logs how many hints reached the
agent.

---

## Configuration

Each repository's settings live on the dashboard at
`/o/<slug>/repos/<owner>/<name>/settings`; a repository with none gets the
defaults. See [`apps/web`](apps/web/README.md#repository-settings).

| Setting | Default | Purpose |
| --- | --- | --- |
| Mode | `every_pr` | `every_pr` reviews every opened, pushed or reopened pull request; `label` only those labelled `ai-review`; `off` none. |
| Model | the provider's own (`gpt-5.6-luna`, `claude-sonnet-5`) | Model id, from those the organization key's provider offers. |
| Fixes | off | Whether verified [fixes](#fixes) are committed to the pull request branch. |

The provider and API key are the organization's, saved by an owner at
`/o/<slug>/settings`. With none saved, a review publishes a neutral check run
asking for one and calls no model.

### Model providers

Models are reached through the [AI SDK](https://ai-sdk.dev). Which providers
are allowed, what each one's default model is, and which environment variable
carries its key live in `packages/ai/src/model.ts`, selected by the saved
key's provider. Adding a provider is an entry in `PROVIDERS` and nothing else.

Prompt caching is explicit on `anthropic`, the provider whose API takes cache
breakpoints (`packages/ai/src/agents/runtime.ts`). On the default provider,
`openai`, caching is automatic by prefix; every call of one review carries the
same `prompt_cache_key`, so its turns are routed to the same cache. OpenAI
reports cache reads but never cache writes, so that counter stays at zero
there; that is expected, not a regression.

### What a review costs

A model API is stateless, so every turn resends the whole conversation —
tools, system prompt, the opening message with the diff, and every tool result
so far. A ten-turn agent bills its opening message ten times. One measured run
of this repository's own PR #11, before caching, spent ~1.58M input tokens
across three agents, from 4 to 10 model calls each — an old measurement of an
older design, whose shape is what carries over.

The agent's `contextGuidance` costs the most, because it must retrieve
surrounding repository context before it may make a claim, and every retrieval
is another round trip carrying the whole conversation.

Prompt caching reprices that traffic rather than reducing it: roughly 0.1x for
a cache read against 1.25x for the write that put it there. Each agent turn asks
for two things to be cached, both via `providerOptions.anthropic.cacheControl`:
the system instructions, through a breakpoint on that message, which also
covers the tool schemas; and the growing conversation tail, through a
call-level breakpoint that Anthropic places on the request's last block. So
turn two reads turn one's opening message and tool results from cache rather
than paying for them again.

A cache that stops hitting raises the bill and changes nothing else, so the
three input counters are reported separately on `agent.completed`, which is where a `pnpm eval` run shows them. On a
warmed-up review `cacheReadInputTokens` should dominate `inputTokens`; if it
collapses to zero, something above a breakpoint started varying between turns.

### Incremental review

On by default: the worker reviews every push, and `REVIEW_INCREMENTAL=false`
turns it off. It narrows what the agent reads on a push to a pull request it
has already reviewed.

**The baseline is the check run itself.** `AI PR Review` is written against each
head commit, so the newest earlier commit carrying a completed one is the commit
the last review read. Nothing extra is stored, and nothing new is granted.

Every way of not finding one widens back to a whole-pull-request review rather
than failing, each logged on `review.scope_resolved` as its `reason`:

| Situation | `reason` |
| --- | --- |
| No earlier commit carries our check run | `no_baseline` — the first review, or `checks: write` was absent |
| The commits or check runs could not be read | `baseline_unreadable` |
| The baseline is not an ancestor of the head | `head_rewritten` — a force-push or a rebase |
| The client declares no `compareCommits` | `no_commit_comparison` — a local checkout or the eval fixture |

The files reviewed are those the comparison reports **intersected with the pull
request's own changed files**. A merge of the base branch into the branch under
review otherwise drags in files the pull request never touched. When that
intersection is empty, the agent does not run.

The agent is handed the narrowed diff; `list_changed_files` and `get_diff`
keep describing the whole pull request, so it asks for the full picture when it
needs it and pays for it then. Validation is unchanged — its existing rule
that a finding must sit on an added line in the diff now confines findings to
lines added since the baseline, with no new rule.

Findings an earlier review posted are still on the pull request as comments.
Any whose thread is neither resolved nor outdated, and which this run did not
report again, are listed on the check run under *still open from earlier
commits*, and hold the conclusion at `neutral`. A narrowed review that found
nothing new must not read as a clean one.

**What it costs you:** a bug introduced in an earlier commit but only visible
given the newest commit's context is outside the diff the agent is handed.
`get_diff` means they can still reach it; nothing makes them. That is the trade
incremental review makes.

### Repository index

Before any agent starts, the reviewer fetches the repository's files at the
pull request's **base** commit in one archive request and builds an in-memory
index of them. Never the head commit: a pull request must not be able to shape
what the reviewer believes about the repository. The index is held for the
review and thrown away — nothing is stored, no service runs, and no permission
beyond `contents: read` is needed.

What it holds is each file's role — source, test, config, migration, generated,
docs, vendored, asset — which test covers which source file by naming
convention, and an **import graph** of every TypeScript and JavaScript
`import`, `export … from`, dynamic `import()` and `require()`. Specifiers
resolve the way the repository's own tooling resolves them, in one order:
a relative path (extensionless, through `index` files, and a written `.js` to
the `.ts` or `.tsx` behind it), then a `#` import map from the nearest
`package.json`, then `tsconfig.json` `paths` with its `extends` chain followed,
then a workspace package name through that package's `exports` map — and then
nothing. A third-party package is never guessed at. Workspace packages
themselves come from `pnpm-workspace.yaml` or `package.json` `workspaces`, and
a manifest too malformed to read costs that one file's contribution, not the
build. Only TypeScript and JavaScript report as indexed; every other language
is seen for its role and its tests and says so.

Each indexed language carries a **resolution rate**: how many of the imports
that are not third-party the index could actually place. A repository whose
alias scheme this resolver does not understand shows it there rather than
silently answering `find_references` with too few files. On this repository the
TypeScript rate is 1.0.

The agent reads the graph through `find_references(path, name?)`: without a
name, every file importing `path` with the line each import sits on; with one,
only the files importing that export, default and namespace (`*`) imports
included and marked. It returns at most 50 files alongside the true `total`,
and every result carries an `index` header — the commit, the file count,
whether the index is truncated, and the per-language coverage — so an empty
answer can be told from an unindexed one. A path this pull request added, or one the index does not
hold, comes back as `known: false` with the reason rather than as a file that
does not exist. The query lives in `@pr-review/index`; the agent tool and the
MCP tool of the same name both render what it returns, so there is one cap, one
header and one unknown-path answer.

The opening message carries five blocks. `<repository>` gives bearings in a
monorepo: every workspace package with its root, the indexed commit, and what
each language contributed, resolution rate included. `<repository_index>` is
one line per changed file — its package, its role, its covering test and its
importer count. `<sibling_files>` names, for each changed file, up to five
unchanged files in the same directory with the same role
([`siblingsOf`](packages/index/src/siblings.ts)): the local convention the
reviewer reads before calling anything drift. `<rule_docs>` is the text of every
`CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING.md` at the repository root or above a
changed file (a `CONTRIBUTING.md` in `.github/` or `docs/` counts as the
root's), numbered by line so a finding can cite one, root first and capped at
12 000 characters; a rule doc the pull request edits is left out, since it
cannot be cited ([`rule-docs.ts`](packages/index/src/rule-docs.ts)).
`<lint_config>` lists the linter, formatter and typecheck configuration
governing the changed files — ESLint, Prettier, Biome, EditorConfig,
`tsconfig.json`, Ruff and the like, and the lint and format scripts of a
`package.json` — each as a short excerpt, capped at 4 000 characters
([`lint-config.ts`](packages/index/src/lint-config.ts)). Both come from the base
commit, never the pull request's head.

Reading the archive is capped at 50 MB, 20 000 files and 512 KB per file, and
`node_modules`, `vendor`, `dist`, `.git` and similar are dropped as it reads.
Hitting a cap marks the index truncated rather than failing; the block says so.
A repository too large to archive, an unreachable endpoint, or any other
failure is logged as `index.failed` and the review runs exactly as it would
without the index.

---

### Fixes

Off by default; a repository owner turns them on in the repository's settings.

What is committed is never what an agent said, only what deterministic code
could prove: every patch quotes the lines it replaces, and a quote that does
not match the file at the head commit character for character is discarded
while its finding is still published. At most 5 files and 200 lines change per
review, and the commit is a plain fast-forward on the branch tip the review
read — a push that landed during the review wins.

Leaving fixes off loses nothing. The same verified patches are rendered as
GitHub suggested changes on the review comments, which apply in one click; that
is also what happens when the branch moved. The review body always says which
of the two happened.

The commit carries a marker line. Its push triggers another review, which runs
as normal but fixes nothing: a run whose head commit is one of ours never
commits on top of it.

### App permissions

Repository **Contents** (read and write), **Pull requests** (read and write),
**Checks** (read and write) and **Metadata** (read); the full list is in
[`apps/web`](apps/web/README.md#registering-the-app). Contents write is used
only for the fix commit; merges and approvals never.

---

## Local development

Requires Node.js `>=22 <26` and pnpm `>=10`.

```sh
pnpm install
pnpm typecheck        # tsc --noEmit across every workspace package
pnpm test             # vitest run — the full Vitest suite
pnpm build            # every package, and the cli, mcp and worker bundles
```

Workspace packages are consumed as TypeScript source and compiled into
self-contained bundles by `scripts/build-bundle.mjs`.

Put local secret values in `.env.local` (gitignored). The worker, the MCP
server and `packages/db` read it.

---

## Command line

[`apps/cli`](apps/cli) is the reviewer as a plain command, for a git hook, a
pre-commit framework or a CI step — anything that is not an MCP client. It
reviews a working tree against its base branch and exits non-zero when it finds
something at or above a severity you choose.

```sh
node apps/cli/start.mjs review                   # commits since the merge-base, plus uncommitted work
node apps/cli/start.mjs review --fail-on medium  # stricter than the default `high`
node apps/cli/start.mjs install-hook             # block a push that carries a high finding
```

It exits `0` when nothing reaches the threshold, `1` when something does, `2`
when the review could not run — a missing model key is reported before any
git or model work begins — and `3` when Ctrl-C cancelled it. Cancelling aborts
the in-flight model calls, and the pre-push hook refuses the push saying the
review was cancelled, not that it found something. Findings print to stdout, one location each;
progress and errors go to stderr.

The installed `pre-push` hook is bypassed without editing it:

```sh
PR_REVIEW_SKIP=1 git push      # skips the review
git push --no-verify           # skips every pre-push hook
```

The command is a second entry point onto the local review path the MCP server
already serves, not a second implementation: the same git-backed client, the
same agent, and the same
[validation chain](#the-trust-boundary) between the model and your terminal.
Options, exit codes and hook installation are in
[`apps/cli/README.md`](apps/cli/README.md).

---

## MCP server

[`apps/mcp`](apps/mcp) runs the reviewer inside a coding agent such as Claude
Code, over local stdio. The repository's [`.mcp.json`](.mcp.json) registers it
as `pr-review`, so opening this repo in Claude Code offers it; any other client
runs `node apps/mcp/start.mjs`, which rebuilds the bundle before it starts.

| Tool | What it does |
| --- | --- |
| `review_local_changes` | Reviews the working tree against its base branch — commits since the merge-base plus uncommitted and untracked files — before anything is pushed |
| `review_pull_request` | Reviews a GitHub pull request; a dry run unless `publish: true`, which posts the check run and comments as the App would |
| `suppress_finding` | Marks a false positive so later reviews of that checkout exclude it and report how many they hid; stored with the checkout, matched by title shape |
| `repository_overview`, `find_references`, `describe_file` | The [repository index](#repository-index), built from the working tree, with no network |
| `list_reviews`, `get_review`, `review_trends` | Stored review history, scoped by the dashboard's own access rules to your GitHub account |

Cancelling a review — Ctrl-C in the client, or any `notifications/cancelled` —
aborts the agent's model calls, and a cancelled run publishes nothing.

A local review takes the same path as the hosted one, with a git-backed client in
place of GitHub's, so the [trust boundary](#the-trust-boundary) is unchanged:
only validated findings come back. It needs an `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; GitHub access
uses `GITHUB_TOKEN` or the `gh` login. Configuration, and the MCP Bundle path
for shipping it beyond this checkout, are in
[`apps/mcp/README.md`](apps/mcp/README.md).

---

## Testing

Every seam that decides what reaches GitHub is covered by unit tests: event
parsing, the agent loop and its tool dispatch, the diff line index, the
validation chain, duplicate removal, and check-run rendering.
The model client and Octokit are both injected behind narrow interfaces, so the
suite makes no network calls and runs in under two seconds.

```sh
pnpm test
```

### Client conformance

Four adapters serve a repository through these interfaces: Octokit
(`packages/github/src/app.ts`), the local checkout
(`apps/mcp/src/local-git-client.ts`), the eval fixture
(`evals/src/fixture-client.ts`), and the agent test fake
(`packages/ai/src/agent-test-support.ts`). One shared suite,
`@pr-review/github/conformance`, runs against all four in `pnpm test`.

Search semantics are not among the differences. `packages/github/src/search.ts`
owns the query grammar, what counts as a match (every term, case-insensitively,
in the contents and never the path), the snippet windows and the caps
(`SEARCH_LIMITS`: 20 matches, 2 snippets of 400 characters each), and all four
adapters call it. `totalCount` stays uncapped, so it is what tells the model a
query was not selective enough.

`ADAPTER_PROFILES` in `packages/github/src/conformance.ts` is the single place
they are still allowed to differ, and every entry is asserted rather than
skipped: how a file is decided to match (`shared` for the local checkout and
the eval fixture; `github-code-index` for Octokit, whose index is GitHub's to
define; `canned` for the test fake), what fills a match's snippets before the
shared cap trims them, the operations each adapter never declares (`absent`) or
declares and rejects (`unsupported`, with the error name), and how a file the
repository does not have is reported. Moving a cap in `SEARCH_LIMITS` fails a
test in every adapter at once.

### The three client interfaces

`packages/github/src/client.ts` declares three interfaces and no wider one;
they are what the profiles table divides along. A caller that needs more than
one names the intersection it needs, so no type says "everything" any more:

| Interface | What it covers | Who declines part of it |
| --- | --- | --- |
| `PullRequestReadClient` | the pull request, its diff, its existing review state, and repository contents, search and archive at a ref | nobody — all four adapters serve every method |
| `RepositoryHistoryClient` | commits: which exist, what they touched, what they say, what a branch points at, how two compare, who last wrote each line of a file | the local checkout (`compareCommits`), the eval fixture (`compareCommits`, `listCommitFiles`, `getCommitMessage`, `blame`) |
| `ReviewPublishClient` | the check run, the review, a commit on a branch, a file written to a branch | the local checkout and the eval fixture, all four methods |

The two repository-only adapters declare only what they honour — the local
checkout `PullRequestReadClient & Omit<RepositoryHistoryClient, "compareCommits">`,
the eval fixture that minus `listCommitFiles`, `getCommitMessage` and
`blame` — so what
they decline is a compile error at the call, not a throw. A review run takes
that narrow `ReviewClient` and writes only through its `ReviewDelivery`, so
publishing is unreachable from a checkout or a fixture twice over: the client
has no publish method, and the delivery closes over no client.

Only the Octokit-backed adapters — `createInstallationClient` and
`createTokenClient` — return all three intersected, because an installation
token really can do all of it; the worker and the MCP server take that
intersection through their environment seams and hand each half to the
narrower consumer that wants it.

`METHOD_GROUPS` in `conformance.ts` carries the same split at runtime, and
`client-groups.test.ts` asserts it against `ADAPTER_PROFILES`: no adapter may
decline a pull-request read, and neither repository-only adapter may declare a
publish method at all.

---

## CI and deploys

`.github/workflows/ci.yml` runs typecheck, lint, tests, and the cli and mcp
bundle smoke checks on every branch push. `main` goes through
`.github/workflows/production.yml`, which runs the same checks, then migrates
the database and deploys the dashboard and the worker — see
[`apps/web`](apps/web/README.md#deploys).

---

## Observability

Structured single-line JSON logs land in the worker's log stream (Cloud
Logging), under event names, grouped by what they trace:

| Stage | Events |
| --- | --- |
| Review | `review.skipped`, `review.started`, `review.model_selected`, `review.loaded`, `review.cancelled`, `review.failed` |
| Scope | `review.scope_resolved`, `review.scope_unreadable`, `review.incremental.no_changes`, `review.carried_forward.unreadable` |
| Index | `index.built`, `index.skipped`, `index.failed` |
| Reviewers | `reviewers.suggested`, `reviewers.skipped`, `reviewers.blame_failed`, `reviewers.failed` |
| Agent | `agent.started`, `agent.completed`, `agent.failed`, `agent.cancelled` |
| Publishing | `findings.validated`, `review.comments.published`, `review.comments.degraded`, `review.comments.list_failed`, `review.published`, `review.published.degraded` |
| Job | `review_job.started`, `review_job.succeeded`, `review_job.superseded`, `review_job.retrying`, `review_job.dropped`, `review_job.no_model_key`, `review_job.recorded`, `review.fixes.disabled` |

Events carry the repository, PR
number, head SHA, duration, finding count, and token usage (four
counters: `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`,
`outputTokens`), so a single review is greppable end to end by `headSha`.

---

## Further reading

- **Propose, refine, decide** — the pipeline traced stage by stage, with a
  diagram, the file that owns each step, and the failure modes. It lives in the
  dashboard's documentation at `/docs/walkthrough`
  ([`apps/web/app/(docs)/`](apps/web/app/(docs))), and the standalone
  [`docs/index.html`](docs/index.html) still serves the same walkthrough on
  [Pages](https://sunnyeyles.github.io/pr-review-agents/) until that site has a
  public URL to retire it to.
- **[Incremental review](docs/incremental-review.md)** — the design behind
  incremental review: where the baseline comes from, every way it widens back
  to a full review, and what recall it costs.

## Out of scope

No automatic merging or approval, no vector database, no repository embeddings.
Review history lives on the dashboard in [`apps/web`](apps/web), stored through
[`packages/db/src/ingest.ts`](packages/db/src/ingest.ts).
