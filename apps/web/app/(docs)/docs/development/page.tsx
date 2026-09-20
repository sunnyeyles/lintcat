import type { Metadata } from "next";

import { Bullet, Bullets, Code, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Local development",
  description: "Commands, what the tests cover, and the events a review run logs.",
};

const HEADINGS: Heading[] = [
  { id: "commands", title: "Commands" },
  { id: "testing", title: "Testing" },
  { id: "prompts", title: "Seeding the managed prompts" },
  { id: "observability", title: "Observability" },
];

export default function DevelopmentPage() {
  return (
    <DocsArticle
      href="/docs/development"
      eyebrow="Reference"
      title="Local development"
      description="Node.js >=22 <26 and pnpm >=10. Workspace packages are consumed as TypeScript source and compiled into one self-contained bundle."
      headings={HEADINGS}
    >
      <Section id="commands" title="Commands">
        <Code>{`pnpm install
pnpm typecheck        # tsc --noEmit across every workspace package
pnpm test             # vitest run
pnpm build            # esbuild -> apps/action/dist/index.mjs`}</Code>
        <P>
          Put local secret values in <code>.env.local</code> (gitignored) when exercising the
          handler outside Actions. The prompt seeder, the MCP server and{" "}
          <code>packages/db</code> read it.
        </P>
      </Section>

      <Section id="testing" title="Testing">
        <P>
          Every seam that decides what reaches GitHub is covered by unit tests: event parsing,
          the agent loop and its tool dispatch, the diff line index, the validation chain,
          duplicate removal, partial-agent-failure semantics, synthesis fallback, check-run
          rendering, and the fork-PR job-summary fallback.
        </P>
        <Note title="No network in the suite">
          The model client and Octokit are both injected behind narrow interfaces, so the suite
          makes no network calls and runs in under two seconds.
        </Note>
      </Section>

      <Section id="prompts" title="Seeding the managed prompts">
        <P>
          One agent prompt is editable in Langfuse per configured agent, but a project only
          serves them once it holds them — until then every review falls back to the in-code
          prompts and reports <code>loadedCount: 0</code>.
        </P>
        <Code>{`pnpm seed-prompts -- --dry-run
pnpm seed-prompts -- --label staging
pnpm seed-prompts`}</Code>
        <P>
          Re-running is a no-op when the labelled version already matches. A prompt edited in
          Langfuse keeps serving reviews and is superseded, not erased, the next time the
          seeder runs.
        </P>
      </Section>

      <Section id="observability" title="Observability">
        <P>
          Structured single-line JSON logs land in the workflow run&rsquo;s own log stream,
          under event names grouped by stage:
        </P>
        <Bullets>
          <Bullet>
            <strong>Review</strong> — <code>review.started</code>,{" "}
            <code>review.model_selected</code>, <code>review.agents_selected</code>,{" "}
            <code>review.cancelled</code>, <code>review.failed</code>.
          </Bullet>
          <Bullet>
            <strong>Agents</strong> — <code>agent.started</code>, <code>agent.completed</code>,{" "}
            <code>agent.failed</code>, <code>agent.skipped</code>.
          </Bullet>
          <Bullet>
            <strong>Synthesis</strong> — <code>synthesis.skipped</code>,{" "}
            <code>synthesis.completed</code>, <code>synthesis.failed</code>.
          </Bullet>
          <Bullet>
            <strong>Publishing</strong> — <code>findings.validated</code>,{" "}
            <code>review.comments.published</code>, <code>review.published</code>, and their{" "}
            <code>.degraded</code> counterparts.
          </Bullet>
        </Bullets>
        <P>
          Events carry the repository, PR number, head SHA, agent name, duration, finding count
          and token usage, so a single review is greppable end to end by <code>headSha</code>.
        </P>
      </Section>
    </DocsArticle>
  );
}
