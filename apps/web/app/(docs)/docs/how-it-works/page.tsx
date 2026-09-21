import type { Metadata } from "next";

import { Bullet, Bullets, Code, DocsArticle, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "The review pipeline",
  description: "One reviewer proposes findings, validation decides what is published.",
};

const HEADINGS: Heading[] = [
  { id: "stages", title: "The stages" },
  { id: "failure", title: "Failure" },
  { id: "memory", title: "Review memory" },
  { id: "index", title: "Repository index" },
];

const STAGES = `reviewer ─► validate ─► END`;

export default function HowItWorksPage() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      eyebrow="How it works"
      title="The review pipeline"
      description="One pipeline runs every review, whether it came from the Action, the MCP server or the command line: the reviewer proposes, and deterministic code decides."
      headings={HEADINGS}
    >
      <Section id="stages" title="The stages">
        <Code>{STAGES}</Code>
        <Bullets>
          <Bullet>
            <strong>reviewer</strong> reads the pull request through eight read-only tools and
            returns raw candidates. Its tool-calling loop is capped at 12 steps.
          </Bullet>
          <Bullet>
            <strong>validate</strong> is the decision: schema, category, file, line,
            confidence, duplicates, cap. It is the last place anything is checked before the
            review is published.
          </Bullet>
        </Bullets>
      </Section>

      <Section id="failure" title="Failure">
        <P>
          If the reviewer fails, the pipeline throws, which fails the workflow step so the run
          can be retried from the Actions UI. Nothing is published for a failed run.
        </P>
      </Section>

      <Section id="memory" title="Review memory">
        <P>
          With <code>memory-branch</code> set, the reviewer gets deprioritisation hints: shapes
          of finding this repository has repeatedly left alone. They are evidence, not rules —
          the prompt still forbids inventing a finding, and a shape with no signal for 90 days
          is forgotten.
        </P>
      </Section>

      <Section id="index" title="Repository index">
        <P>
          Before the reviewer starts, the review builds an index from the pull request&rsquo;s
          base commit, which is what <code>find_references</code> answers from. Set{" "}
          <code>index: false</code> to turn it off.
        </P>
      </Section>
    </DocsArticle>
  );
}
