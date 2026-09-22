import type { Metadata } from "next";

import { Bullet, Bullets, Code, DocsArticle, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "The review pipeline",
  description: "One reviewer proposes findings, validation decides what is published.",
};

const HEADINGS: Heading[] = [
  { id: "stages", title: "The stages" },
  { id: "index", title: "Repository index" },
  { id: "failure", title: "When a review fails" },
];

const STAGES = `reviewer ─► validate ─► publish`;

export default function HowItWorksPage() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      eyebrow="How it works"
      title="The review pipeline"
      description="Every review, from the GitHub App or from the MCP server, runs the same pipeline: the reviewer proposes, and deterministic code decides."
      headings={HEADINGS}
    >
      <Section id="stages" title="The stages">
        <Code>{STAGES}</Code>
        <Bullets>
          <Bullet>
            <strong>reviewer</strong> reads the pull request through eight read-only tools and
            returns candidate findings. It gets at most 12 tool-calling steps.
          </Bullet>
          <Bullet>
            <strong>validate</strong> makes the decision: schema, category, file, line,
            confidence, duplicates, cap. It is the last check before anything is published.
          </Bullet>
          <Bullet>
            <strong>publish</strong> posts the check run and inline comments to GitHub and
            records the review on your dashboard.
          </Bullet>
        </Bullets>
      </Section>

      <Section id="index" title="Repository index">
        <P>
          Before the reviewer starts, LintCat indexes the repository at the pull
          request&rsquo;s base commit. That is how the reviewer finds the callers of a function
          your change touched, even in files the pull request didn&rsquo;t change.
        </P>
      </Section>

      <Section id="failure" title="When a review fails">
        <P>
          A failed review is retried automatically, up to three attempts in all. If the last
          one fails too, the pull request gets a <code>failure</code> check run saying the
          review gave up. Push again, or remove and re-add the <code>ai-review</code> label,
          to try again.
        </P>
      </Section>
    </DocsArticle>
  );
}
