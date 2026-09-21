import type { Metadata } from "next";

import { Bullet, Bullets, Code, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Add one workflow file and the next pull request gets a review.",
};

const HEADINGS: Heading[] = [
  { id: "workflow", title: "Add the workflow" },
  { id: "key", title: "Give it a key" },
  { id: "result", title: "What lands on the pull request" },
];

const WORKFLOW = `name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  contents: write      # read is enough; write only for memory-branch
  pull-requests: write
  checks: write        # omit and reviews still land, in the job summary

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: sunnyeyles/pr-review-action@v2
        with:
          api-key: \${{ secrets.OPENAI_API_KEY }}`;

export default function QuickstartPage() {
  return (
    <DocsArticle
      href="/docs/quickstart"
      eyebrow="Start here"
      title="Quickstart"
      description="One workflow file in your repository, a provider key in secrets, and the next pull request is reviewed. Nothing else to run."
      headings={HEADINGS}
    >
      <Section id="workflow" title="Add the workflow">
        <P>
          Commit this as <code>.github/workflows/ai-review.yml</code>. The{" "}
          <code>closed</code> trigger and <code>contents: write</code> are needed only for
          review memory; without it, drop both back to{" "}
          <code>types: [opened, synchronize, reopened]</code> and <code>contents: read</code>.
        </P>
        <Code caption=".github/workflows/ai-review.yml">{WORKFLOW}</Code>
      </Section>

      <Section id="key" title="Give it a key">
        <P>
          <code>api-key</code> is the key for the selected provider. Store it as a repository
          or organisation secret — never inline it. Left empty, the Action falls back to the
          provider&rsquo;s own variable (<code>OPENAI_API_KEY</code>,{" "}
          <code>ANTHROPIC_API_KEY</code>), so a workflow can pass keys through{" "}
          <code>env</code> instead of choosing one in YAML.
        </P>
        <Code caption="Anthropic instead of the default">{`with:
  model-provider: anthropic
  api-key: \${{ secrets.ANTHROPIC_API_KEY }}
  model: claude-sonnet-5`}</Code>
      </Section>

      <Section id="result" title="What lands on the pull request">
        <Bullets>
          <Bullet>
            Inline review comments on the lines the findings point at, one per finding.
          </Bullet>
          <Bullet>
            An <code>AI PR Review</code> check run carrying the full summary. Its conclusion is{" "}
            <code>neutral</code> whenever findings exist — the review is advisory and never
            blocks a merge.
          </Bullet>
          <Bullet>
            One-click suggested changes wherever a finding carried a patch that verified
            against the head commit.
          </Bullet>
        </Bullets>
        <Note title="Every permission degrades">
          Without <code>pull-requests: write</code> the check run annotates the same lines
          instead. Without <code>checks: write</code> the whole review is written to the job
          summary. Only <code>contents: read</code> is required to run at all.
        </Note>
      </Section>
    </DocsArticle>
  );
}
