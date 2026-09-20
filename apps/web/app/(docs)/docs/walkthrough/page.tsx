import type { Metadata } from "next";

import {
  Bullet,
  Bullets,
  Code,
  DocsArticle,
  DocsTable,
  Note,
  P,
  Section,
  Subheading,
} from "@/components/docs";
import { Stat, StatGrid } from "@/components/ui/stat";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Propose, refine, decide",
  description:
    "One pull request event in, one check run out — the pipeline traced in the order it actually executes.",
};

const HEADINGS: Heading[] = [
  { id: "flow", title: "The whole path" },
  { id: "inspect", title: "01 · Is this even a review?" },
  { id: "boot", title: "02 · Boot" },
  { id: "load-gate", title: "03 · Load and gate" },
  { id: "pipeline", title: "04 · The pipeline" },
  { id: "render", title: "05 · Render" },
  { id: "publish", title: "06 · Publish" },
  { id: "failure-modes", title: "What fails the run" },
  { id: "log-events", title: "Lifecycle log events" },
  { id: "file-map", title: "Where things live" },
  { id: "run-it", title: "Run it yourself" },
];

const FLOW = `pull_request event                      GITHUB_EVENT_PATH
   │
   ▼
inspectEvent          reviewable? otherwise a clean no-op
   │
   ▼
runAction             client · agents · model · tracing · prompts
   │
   ▼
reviewPullRequest     load PR + changed files + diff
   │
   ▼
gateAgentsByPaths     who wakes · none => neutral check, no review
   │
   ▼
runReviewPipeline
   │
   ├─ security         authz · injection · leaks
   ├─ correctness      logic · bounds · nulls
   ├─ performance      N+1 · scans · blocking
   ├─ test-coverage    untested branches
   └─ docs-drift       README · flags · examples
   │
   ▼
join                  fan-in, re-sorted to agent order
   │
   ▼
synthesise            one model call · no tools · no loop
   │
   ▼
validate              the trust boundary · 7 deterministic steps
   │
   ▼
render                pure · no I/O
   │
   ├─ review comments  then a check run
   └─ job summary      fork fallback · 403/404`;

const BOOT = `// Resolved before the model client is built, so a bad config fails the step
// rather than producing a review that looks clean.
const configured = await loadAgentDefinitions({
  readFile: readAtCommit(client, target, baseSha),
  path: getInput(env, "agent-config") || DEFAULT_AGENT_CONFIG_PATH,
});
const selection = getInput(env, "agents");
const agents = resolveAgentDefinitions(selection, configured);`;

const LOAD = `const [pullRequest, changedFiles, diff] = await Promise.all([
  client.getPullRequest(target),
  client.listChangedFiles(target),
  client.getDiff(target),
]);
const { active, skipped } = gateAgentsByPaths(agents, filenames);`;

const PIPELINE = `const outcomes = await Promise.all(
  agents.map((agent) => runAgent(agent, context)),
);                                  // fan-in: waits for all
const { candidates, agentFailures } = join(outcomes);
const synthesis = await synthesise(synthesiser, candidates);
const findings = validateFindings(synthesis.candidates, changedFiles, names);`;

const RUNTIME = `const result = await generateText({
  model,
  instructions: { role: "system", content: systemPrompt, providerOptions: CACHE_BREAKPOINT },
  messages: [{ role: "user", content: buildOpeningMessage(context) }],
  tools: createReviewTools(deps.github, context),
  stopWhen: isStepCount(maxTurns),        // 12 by default
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  providerOptions: CACHE_BREAKPOINT,
  onStepEnd: (step) => { usage = addTokenUsage(usage, toTokenUsage(step.usage)); },
});
// The SDK stops silently at the cap, still holding tool calls.
if (result.finishReason === "tool-calls") {
  throw new AgentRunError("... exceeded the turn cap");
}`;

const PERMISSION_ERROR = `// Status alone: GitHub's message wording is not part of any API contract.
// 404 too, not just 403 — GitHub hides a private repo from a read-only token.
const status = httpStatus(error);
return status === 403 || status === 404;`;

const LOG_FLOW = `review.agents_selected -> review.model_selected
review.started
  -> review.loaded
    -> agent.skipped xN / review.no_agents_matched (then stop)
    -> agent.started xN  -> agent.completed / agent.failed xN
    -> synthesis.started -> synthesis.completed / .failed / .skipped
    -> findings.validated
    -> patches.verified
  -> review.fixes.applied / .degraded / .disabled
  -> review.comments.published / .degraded / .list_failed
  -> review.published / review.published.degraded / review.failed`;

const AGENT_CONFIG = `agents:
  - security
  - agent: docs-drift
    model: gpt-5-mini
    paths: ["docs/**", "README.md", "!**/*.test.ts"]`;

const EVAL_COMMANDS = `pnpm test

ANTHROPIC_API_KEY=... pnpm eval`;

export default function WalkthroughPage() {
  return (
    <DocsArticle
      href="/docs/walkthrough"
      eyebrow="How it works"
      title="Propose, refine, decide"
      description="One pull request event in, one check run out — traced in the order it actually executes. The agents you configure propose candidate findings. One synthesiser refines them. Then deterministic code decides, and only that last step is ever allowed to reach the GitHub API."
      headings={HEADINGS}
    >
      <StatGrid>
        <Stat label="Review agents" value="n" hint="from config" />
        <Stat label="Read-only tools" value="8" />
        <Stat label="Turn cap / agent" value="12" />
        <Stat label="Validation steps" value="7" />
        <Stat label="Findings published" value="10" hint="at most" />
      </StatGrid>

      <Section id="flow" title="The whole path">
        <Code>{FLOW}</Code>
        <Note title="Everything above validate is untrusted model output">
          Nothing above it can reach the GitHub API.
        </Note>
      </Section>

      <Section id="inspect" title="01 · Is this even a review?">
        <P>
          <code>apps/action/src/event.ts</code> · <code>inspectEvent</code>, with the trigger
          list in <code>packages/schemas/src/pull-request-event.ts</code>.
        </P>
        <P>
          This runs before any client, any config read and any model — it is the first thing{" "}
          <code>runAction</code> does after parsing <code>GITHUB_EVENT_PATH</code>. An event
          that will not be reviewed has no base commit to read an agent config from, so asking
          the question first is what lets the answer &ldquo;no&rdquo; cost nothing.
        </P>
        <DocsTable
          caption="The two outcomes of inspecting an event."
          columns={["Outcome", "When", "Result"]}
          rows={[
            [
              "Not a review",
              <>
                Wrong event name, or an ignored action like <code>labeled</code>
              </>,
              <>
                Logs <code>review.skipped</code>, step succeeds
              </>,
            ],
            [
              "Malformed",
              <>
                Claims to be a supported <code>pull_request</code> event but fails the schema
              </>,
              "Throws — fails the workflow",
            ],
          ]}
        />
        <P>
          Most workflow triggers are not reviews, so ignoring one quietly has to be a success.
          A payload that should have parsed and did not is a bug worth failing over. A
          reviewable event yields the target, the base SHA, and whether the pull request came
          from a fork.
        </P>
      </Section>

      <Section id="boot" title="02 · Boot">
        <P>
          <code>apps/action/src/index.ts</code>. <code>runEntrypoint()</code> runs at import
          time but returns immediately unless <code>GITHUB_ACTIONS === &quot;true&quot;</code>,
          so importing the module in a test does no work and needs no configuration.
        </P>
        <P>
          <code>runAction</code> then resolves configuration in a deliberate order. The GitHub
          client comes first — the agent config lives in the repository, so reading it needs a
          client. Agents are resolved next, before the model client exists, because a missing
          config or a typo&rsquo;d agent name must cost nothing to discover.
        </P>
        <Code caption="apps/action/src/index.ts">{BOOT}</Code>
        <Note title="Read at the base commit">
          A pull request cannot choose the agents that review it.
        </Note>
        <P>
          A review with no agents, or a silently dropped <code>agents: secuirty</code>, would
          report nothing — indistinguishable from a clean bill of health. So{" "}
          <code>loadAgentDefinitions</code> refuses a missing config instead of defaulting, and{" "}
          <code>resolveAgentDefinitions</code> rejects unknown names instead of ignoring them.
        </P>
        <DocsTable
          caption="Each boot step, and whether failing it fails the run."
          columns={["Step", "Function", "Fails the run?"]}
          rows={[
            ["GitHub client", "createTokenClient", "Yes — missing token"],
            ["Load configured agents", "loadAgentDefinitions", "Yes — missing or malformed config"],
            ["Narrow to the selection", "resolveAgentDefinitions", "Yes — unknown name"],
            ["Model client", "createLanguageModel", "Yes — unknown provider or missing key"],
            ["Langfuse tracing", "createLangfuseRuntime", "No — optional"],
            ["Managed prompts", "loadManagedPrompts", "No — falls back per prompt"],
          ]}
        />
        <P>
          Tracing starts before the prompt fetch, so the fetch&rsquo;s own spans are captured;
          prompts resolve before anything that consumes them is built.{" "}
          <code>createLanguageModel</code> is the only place a provider is chosen.
        </P>
        <Subheading>
          What an <code>agents:</code> entry may be
        </Subheading>
        <P>
          Two spellings, one resolved <code>AgentDefinition</code>. Every entry names a
          specialist that ships with the action; the file selects and tunes them rather than
          defining them.
        </P>
        <Code caption=".github/pr-review-agents.yml">{AGENT_CONFIG}</Code>
        <DocsTable
          caption="The fields an agents entry may carry."
          columns={["Field", "Required", "Meaning"]}
          rows={[
            [
              "agent",
              "Yes",
              "A built-in's name, and the one finding category it may report",
            ],
            ["model", "No", "Model id for this agent alone, as the provider spells it"],
            [
              "paths",
              "No",
              "Globs deciding whether the agent runs at all. Never reaches a prompt",
            ],
          ]}
        />
        <P>
          The schema is <code>.strict()</code>: a misspelled optional key is an error, not a
          silently dropped field.
        </P>
      </Section>

      <Section id="load-gate" title="03 · Load and gate">
        <P>
          <code>packages/reviewer/src/review-pull-request.ts</code>. Three GitHub reads,
          concurrently. This is the only place the review context is built.
        </P>
        <Code caption="packages/reviewer/src/review-pull-request.ts">{LOAD}</Code>
        <Note title="One source of truth">
          <code>changedFiles</code> is read by the agents and by <code>validate</code>, so
          validation can never check findings against a different set of files than the one the
          agents actually reviewed.
        </Note>
        <P>
          An agent that declares no <code>paths</code> runs on every pull request. An agent
          that declares some runs only when a changed file matches — and once it wakes it
          reviews the whole pull request, not just the files that matched. Patterns are POSIX
          only, and a leading <code>!</code> negates.
        </P>
        <P>
          A pull request no agent matched is never reviewed — and never green.{" "}
          <code>renderNoAgentMatched</code> publishes a neutral check listing every skipped
          agent and what it was waiting on, and the pipeline is never entered. A green check
          would read as a clean bill of health nobody gave.
        </P>
      </Section>

      <Section id="pipeline" title="04 · The pipeline">
        <P>
          <code>packages/reviewer/src/review-pipeline.ts</code>. Every active agent is started
          together, so they run concurrently. The three steps after them run in sequence once
          every agent has settled.
        </P>
        <Code caption="runReviewPipeline">{PIPELINE}</Code>

        <Subheading>Each agent</Subheading>
        <P>
          Every agent shares one runtime. An <code>AgentDefinition</code> supplies the role,
          the focus text and the category; the loop, the eight tools, the injection hardening
          and the output contract are identical by construction. The loop itself is the AI
          SDK&rsquo;s — the runtime&rsquo;s job is the boundary around it: cap the turns,
          notice when the cap was hit, and refuse anything that is not the agent&rsquo;s own
          category.
        </P>
        <Code caption="packages/ai/src/agents/runtime.ts">{RUNTIME}</Code>
        <P>
          Hitting the cap is a failure, not a truncated answer: an agent still mid-tool-call
          has not reported, and its silence must not be read as &ldquo;found nothing&rdquo;.
          The token counter lives outside the <code>try</code>, so an agent that dies mid-loop
          still reports what it spent.
        </P>
        <P>
          Each turn asks for two things to be cached: a breakpoint on the system message pins
          the shared prefix, tools included, and a call-level one follows the growing
          conversation tail. The three input counters are logged separately on{" "}
          <code>agent.completed</code> for exactly that reason — a cache that stops hitting
          raises the bill and changes nothing else.
        </P>
        <P>
          <code>extractAgentOutput</code> takes the outermost JSON object out of the final
          message and Zod-validates it; output it cannot parse fails the agent rather than
          crashing the run. The runtime then filters findings down to the agent&rsquo;s own
          category. Cross-category leaks are dropped, never re-stamped.
        </P>

        <Subheading>The eight tools</Subheading>
        <P>
          These are the only tools any agent ever gets. There is no write, comment, approve,
          merge or execute tool anywhere in the package — the restriction holds by construction
          rather than by prompt.
        </P>
        <DocsTable
          caption="The eight read-only tools an agent may call."
          columns={["Tool", "Reads"]}
          rows={[
            ["get_pull_request", "Title, description, author, branches, SHAs"],
            ["list_changed_files", "The changed-file list"],
            ["get_diff", "One changed file's patch by path, or the whole unified diff"],
            ["get_file", "One file at the head SHA — the proposed state"],
            ["get_base_file", "One file at the base SHA — before this PR"],
            [
              "search_repository",
              "Code search with matching snippets and the repository-wide total, always scoped to this repository",
            ],
            [
              "find_references",
              "Files importing one file, or one of its exported names, resolved from the repository index at the base SHA",
            ],
            [
              "find_co_changed_files",
              "Files edited in the same recent commits as one file — correlation, not dependency",
            ],
          ]}
        />
        <P>
          The first three answer from what the run already loaded, so they cost no GitHub call.{" "}
          <code>search_repository</code> and <code>find_co_changed_files</code> read the
          default branch: their results do not reflect this pull request and their snippets
          carry no line numbers, so a claim about a changed file still needs{" "}
          <code>get_file</code>.
        </P>
        <P>
          <code>find_references</code> is different — it answers from the repository index
          built at the base commit, so what it returns is the import statements themselves
          rather than a text search. Every result carries a header naming the commit, whether
          the index is truncated, which languages were parsed and how much of each one&rsquo;s
          internal imports were placed, so an agent can tell an empty answer from an unindexed
          one.
        </P>
        <P>
          Every input is Zod-validated by the tool&rsquo;s own <code>inputSchema</code> before
          it touches the GitHub client: paths may not be absolute or contain traversal
          segments, and a search may not carry <code>repo:</code>, <code>org:</code> or{" "}
          <code>user:</code> qualifiers. A failing <code>execute</code> becomes an error result
          the model reads and continues from, and every result is truncated at 50k characters.
        </P>

        <Subheading>join — the fan-in</Subheading>
        <P>
          <code>Promise.all</code> resolves once every agent has settled, and preserves the
          agent&rsquo;s input position, never completion order. One failed agent does not fail
          the review; all of them does.
        </P>

        <Subheading>synthesise</Subheading>
        <P>
          One model call. No tools, no loop. Candidates that are not well-formed findings are
          dropped before the call, so malformed agent output never buys tokens. From what is
          left it removes duplicates, merges overlapping findings, drops speculation, corrects
          severity where it is clearly wrong, and orders what survives most important first.
        </P>
        <DocsTable
          caption="What each synthesis path reports."
          columns={["Path", "Trigger", "synthesis.outcome"]}
          rows={[
            ["Skipped", "Zero candidates — nothing to refine, so no model call at all", '"skipped"'],
            ["Completed", "Model returned valid JSON", '"completed"'],
            ["Failed", "Bad output or an API error — the raw candidates are used instead", '"failed"'],
          ]}
        />
        <P>
          A synthesis failure never fails the review. Falling back to the raw candidates is
          safe precisely because the synthesiser&rsquo;s output was never trusted either — both
          paths flow through the same chain next.
        </P>

        <Subheading>validate — the trust boundary</Subheading>
        <P>
          Seven deterministic steps, in this order. No I/O, no model, no mutation of its
          inputs.
        </P>
        <Bullets>
          <Bullet>
            Schema validity — <code>reviewFindingSchema</code> (Zod).
          </Bullet>
          <Bullet>
            The category belongs to one of the run&rsquo;s agents — the schema cannot check
            this, since the set is known only at runtime.
          </Bullet>
          <Bullet>The file exists among the PR&rsquo;s changed files.</Bullet>
          <Bullet>The line is an added line in that file&rsquo;s diff, when a line is given.</Bullet>
          <Bullet>
            Confidence ≥ 0.7 — <code>CONFIDENCE_THRESHOLD</code>.
          </Bullet>
          <Bullet>Duplicate removal — the strongest of each group survives.</Bullet>
          <Bullet>
            Cap at 10 — <code>MAX_FINDINGS</code>, keeping the strongest.
          </Bullet>
        </Bullets>
        <P>
          &ldquo;Strongest&rdquo; is fully deterministic: severity rank, then confidence
          descending, then input order. Dedup runs before the cap, so duplicates — which
          several agents reviewing one diff produce routinely — cannot consume cap slots and
          leave the review short.
        </P>
        <Note title="This is where bad output dies">
          A fabricated file path, an invented line number or a padded confidence score is
          dropped here, regardless of how confident the model sounded when it proposed it.
        </Note>

        <Subheading>verifyPatches — proving a fix</Subheading>
        <P>
          A finding may carry a patch: a replacement for a line range, quoted alongside the
          expected text it replaces. The quote is the whole mechanism — the file is re-read at
          the head commit and compared character for character. There is no fuzzy match and no
          apply-with-offset.
        </P>
        <Bullets>
          <Bullet>
            The range&rsquo;s current text equals <code>expected</code>, byte for byte, at the
            head commit.
          </Bullet>
          <Bullet>
            The range touches the diff — an agent may not rewrite a part of the file this PR
            never changed.
          </Bullet>
          <Bullet>No two kept patches overlap in one file.</Bullet>
          <Bullet>
            Cap at 5 files and 200 lines — <code>MAX_PATCHED_FILES</code>,{" "}
            <code>MAX_PATCHED_LINES</code>.
          </Bullet>
        </Bullets>
        <P>
          Every rejection strips only the patch. The finding is published as it would have been
          without one, so a miscounted line number never silences a real problem.
        </P>
      </Section>

      <Section id="render" title="05 · Render">
        <P>
          <code>render-check-run.ts</code>, <code>render-review.ts</code> and{" "}
          <code>finding-format.ts</code> are pure — the caller owns the actual GitHub API call.
          One shared formatter, so a finding reads identically on the check run and in a review
          comment.
        </P>
        <DocsTable
          caption="What conclusion each situation renders, and why."
          columns={["Situation", "Conclusion", "Why"]}
          rows={[
            ["No findings, no failures", "success", '"No issues found"'],
            ["Any findings", "neutral", "Advisory — the app never blocks or approves a merge"],
            [
              "An agent failed, even with zero findings",
              "neutral",
              "An incomplete review must not publish a clean bill of health",
            ],
            [
              "No agent's paths matched",
              "neutral",
              "Nothing was reviewed; the summary names each skipped agent",
            ],
          ]}
        />
        <P>
          Line-anchored findings also become inline annotations. Failed agents appear in the
          summary by name only — the error detail was already logged as{" "}
          <code>agent.failed</code> at failure time and is never re-emitted here.
        </P>
      </Section>

      <Section id="publish" title="06 · Publish">
        <P>
          <code>publish-review.ts</code> · <code>deliverReview</code>. Inline comments go
          first, and the check run annotates only what no comment carries — including comments
          an earlier commit already left. Annotations are the fallback surface, not a
          duplicate.
        </P>
        <DocsTable
          caption="What each comments outcome means for annotations."
          columns={["comments", "Meaning", "Annotations"]}
          rows={[
            ['"posted"', "Fresh comments landed on this commit", "No"],
            ['"already-posted"', "Every finding was commented on an earlier commit", "No"],
            ['"unavailable"', "The token cannot post comments (fork)", "Yes"],
            ['"nothing-to-post"', "No findings", "N/A"],
          ]}
        />
        <P>
          Then the check run. On a 403 or 404, the same rendered review is written to the
          workflow job summary and the step exits cleanly — that is the fork case, where GitHub
          hands the workflow a read-only token.
        </P>
        <Code caption="packages/github/src/errors.ts · isPermissionError">
          {PERMISSION_ERROR}
        </Code>
        <P>
          Everything else propagates and fails the step: 401 is a bad token, 429 is rate
          limiting, 5xx is an outage, and an error with no status at all is a network failure.
          None of those may masquerade as a delivered review. Too permissive, and a real GitHub
          outage renders as a clean review nobody investigates; too strict, and every fork pull
          request fails CI.
        </P>
      </Section>

      <Section id="failure-modes" title="What fails the run, and what doesn't">
        <DocsTable
          caption="Every failure mode, and what the run does about it."
          columns={["Event", "Result"]}
          rows={[
            ["Missing, malformed, or unknown-agent config", "Fails before any model call"],
            ["Missing API key or token", "Fails"],
            ["Malformed pull_request payload", "Fails"],
            ["Every agent fails", "Fails — re-runnable from the Actions UI"],
            ["An agent hits the 12-turn cap", 'Fails that agent — silence is not "found nothing"'],
            ["Unsupported event or ignored action", "Clean no-op"],
            ["No agent's paths matched", "Neutral check — not reviewed, and not green"],
            ["One or two agents fail", "Continues — names listed in the check run"],
            ["Synthesis fails", "Continues — raw candidates published"],
            ["A tool call fails", "Continues — reported to the model"],
            ["Langfuse unreachable", "Continues — in-code prompts, no traces"],
            ["Check run forbidden (fork)", "Degrades — job summary instead"],
            ["Comments forbidden (fork)", "Degrades — the check run annotates instead"],
            [
              "Every finding already commented on an earlier commit",
              "No review posted and no annotations; the check run summary still lists them",
            ],
          ]}
        />
      </Section>

      <Section id="log-events" title="Lifecycle log events">
        <P>
          Every event of one review carries <code>repository</code>,{" "}
          <code>pullRequestNumber</code> and <code>headSha</code>, so an operator can answer
          &ldquo;what happened to the review for PR N?&rdquo; from the logs alone.
        </P>
        <Code>{LOG_FLOW}</Code>
        <P>
          <code>agent.completed</code> and <code>agent.failed</code> both carry four token
          counters, not two: where a provider caches, the three input counters bill
          differently.
        </P>
      </Section>

      <Section id="file-map" title="Where things live">
        <DocsTable
          caption="The file that owns each step of the run."
          columns={["Path", "Owns"]}
          rows={[
            ["apps/action/action.yml", "The Action manifest: every input, and the bundle it runs"],
            ["scripts/build-bundle.mjs", "esbuild → one self-contained dist/index.mjs"],
            ["apps/action/src/event.ts", "Actions event parsing, and the ignore-quietly rule"],
            [
              "packages/schemas/src/pull-request-event.ts",
              "Which pull_request actions trigger a review",
            ],
            [
              "apps/action/src/index.ts",
              "Inputs, client construction, wiring — every dependency is built here",
            ],
            ["packages/github/src/token.ts", "The Octokit client, from the workflow token"],
            ["packages/ai/src/model.ts", "Provider registry, and the default model"],
            ["packages/ai/src/agents/config.ts", "Reading and validating a repository's agents"],
            [
              "packages/ai/src/agents/definition.ts",
              "What an agent is, and its shared system prompt",
            ],
            ["packages/ai/src/agents/specialists/", "The built-ins a config may name"],
            [
              "packages/ai/src/agents/agent-set.ts",
              "Narrowing an agent set, gating it, building its agents",
            ],
            ["packages/ai/src/prompts.ts", "Managed prompts and their fallback"],
            [
              "packages/reviewer/src/review-pull-request.ts",
              "One review, end to end; the path gate; the side-effect boundary",
            ],
            ["packages/github/src/client.ts", "The client interface and every type the run reads"],
            [
              "packages/github/src/app.ts",
              "The Octokit implementation: pagination, Zod-parsed responses",
            ],
            ["packages/ai/src/agents/path-filter.ts", "The paths globs, and which agents they wake"],
            [
              "packages/reviewer/src/review-pipeline.ts",
              "Agent fan-out, join, synthesise, validate",
            ],
            [
              "packages/ai/src/agents/runtime.ts",
              "The shared agent loop, its turn cap, and the category filter",
            ],
            ["packages/ai/src/agents/tools.ts", "The eight read-only tools"],
            [
              "packages/ai/src/agents/output.ts",
              "Parsing an agent's final JSON; bad output fails the agent, not the run",
            ],
            ["packages/ai/src/agents/synthesiser.ts", "The single refining model call"],
            ["packages/reviewer/src/validate-findings.ts", "The trust boundary"],
            [
              "packages/reviewer/src/validate-patches.ts",
              "Proving a proposed fix against the file at head",
            ],
            ["packages/reviewer/src/diff-lines.ts", "Which lines a finding may anchor to"],
            ["packages/schemas/src/review-finding.ts", "The finding contract"],
            ["packages/reviewer/src/render-check-run.ts", "Findings → check run payload"],
            ["packages/reviewer/src/render-review.ts", "Findings → review body + inline comments"],
            [
              "packages/reviewer/src/publish-review.ts",
              "Fixes, then comments, then check run; which surface carries what",
            ],
            [
              "packages/reviewer/src/apply-fixes.ts",
              "Committing verified fixes, and every reason not to",
            ],
            ["packages/github/src/errors.ts", "What a 403/404 means for a write"],
            ["apps/action/src/summary.ts", "Fork fallback to the job summary"],
            ["packages/logging/src/index.ts", "One JSON line per lifecycle event"],
            [
              "evals/fixtures/",
              "Fixture repositories, each a pull request with a known answer",
            ],
            [
              "evals/src/run-fixture-review.ts",
              "The real pipeline over a fixture — only the client and publish differ",
            ],
          ]}
        />
      </Section>

      <Section id="run-it" title="Run it yourself">
        <P>
          The whole path above runs against a fixture repository on your own machine. A fixture
          is a directory: <code>repo/</code> is the tree at the head commit, <code>base/</code>{" "}
          holds the previous contents of the modified files, and a manifest names the pull
          request. The harness builds the diff from those two trees and serves every tool call
          from memory, so nothing reaches GitHub — the two publish steps are the only things
          replaced.
        </P>
        <Code caption="from the repository root">{EVAL_COMMANDS}</Code>
        <P>
          <code>pnpm test</code> is the unit suite: every package, scripted agents, no fixture
          repositories, no API key and no network. <code>pnpm eval</code> runs the full
          pipeline over a fixture, with a real model reviewing real code.
        </P>
        <P>
          The fixtures fail in different directions. Four plant one bug each for one agent to
          find — <code>security-tenant-scope</code> queries customers without checking the
          tenant, <code>correctness-admin-check</code> assigns where it meant to compare,{" "}
          <code>performance-n-plus-one</code> queries once per order line, and{" "}
          <code>test-coverage-untested-branch</code> adds a pricing tier the untouched test
          never exercises. The fifth, <code>clean-pagination</code>, is correct code that must
          produce no findings at all — the case that catches a model inventing problems to look
          useful.
        </P>
      </Section>
    </DocsArticle>
  );
}
