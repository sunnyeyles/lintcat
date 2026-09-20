import type { Metadata } from "next";

import { Bullet, Bullets, Code, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "The review pipeline",
  description:
    "Every selected agent proposes, a synthesiser merges, validation decides what is published.",
};

const HEADINGS: Heading[] = [
  { id: "stages", title: "The stages" },
  { id: "concurrency", title: "Concurrency" },
  { id: "partial-failure", title: "Partial failure" },
  { id: "memory", title: "Review memory" },
  { id: "index", title: "Repository index" },
];

const STAGES = `agent__<agent 1>  ─┐
agent__<agent 2>   ├─► join ─► synthesise ─► validate ─► END
agent__<agent n>  ─┘`;

export default function HowItWorksPage() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      eyebrow="How it works"
      title="The review pipeline"
      description="One pipeline runs every review, whether it came from the Action or the MCP server: the selected agents propose, one synthesiser refines, and deterministic code decides."
      headings={HEADINGS}
    >
      <Section id="stages" title="The stages">
        <Code caption="packages/reviewer/src/review-pipeline.ts">{STAGES}</Code>
        <Bullets>
          <Bullet>
            <strong>Agents</strong> read the pull request through eight read-only tools and
            return raw candidates.
          </Bullet>
          <Bullet>
            <strong>join</strong> collects outcomes in the agents&rsquo; original order, never
            completion order.
          </Bullet>
          <Bullet>
            <strong>synthesise</strong> dedupes, merges and re-ranks across agents. It is the
            last place a model touches the review.
          </Bullet>
          <Bullet>
            <strong>validate</strong> is the decision: schema, category, file, line,
            confidence, duplicates, cap.
          </Bullet>
        </Bullets>
        <P>
          When the general agent runs alone — the default — synthesis is skipped and reported
          as <code>synthesis.outcome: &quot;skipped&quot;</code> with reason{" "}
          <code>standalone agent</code>. There is nothing to merge, and validation still
          removes duplicates.
        </P>
      </Section>

      <Section id="concurrency" title="Concurrency">
        <P>
          The agents are started together with <code>Promise.all</code>, so they run
          concurrently. Inside one agent, the tool-calling loop is a single{" "}
          <code>generateText</code> call, capped at 12 steps.
        </P>
      </Section>

      <Section id="partial-failure" title="Partial failure">
        <P>
          One failed agent does not fail the review — what succeeded is published. Only when{" "}
          <em>every</em> agent fails does the pipeline throw, which fails the workflow step so
          the run can be retried from the Actions UI.
        </P>
        <Note title="Synthesis fails softer still">
          A failed synthesis falls back to the raw candidates and reports{" "}
          <code>synthesis.outcome: &quot;failed&quot;</code> on the result rather than failing
          the review.
        </Note>
      </Section>

      <Section id="memory" title="Review memory">
        <P>
          With <code>memory-branch</code> set, one read of the memory file serves both halves
          of the pipeline. The agents get deprioritisation hints; the synthesiser gets a{" "}
          <code># Repository history</code> block — up to five shapes this repository acted on
          to keep, and up to five it has repeatedly left alone to cut first.
        </P>
        <P>
          Both lists are evidence, not rules: the prompt still forbids inventing a finding, and
          a shape with no signal for 90 days is forgotten.
        </P>
      </Section>

      <Section id="index" title="Repository index">
        <P>
          Before the agents start, the review builds an index from the pull request&rsquo;s
          base commit, which is what <code>find_references</code> answers from. Set{" "}
          <code>index: false</code> to turn it off.
        </P>
      </Section>
    </DocsArticle>
  );
}
