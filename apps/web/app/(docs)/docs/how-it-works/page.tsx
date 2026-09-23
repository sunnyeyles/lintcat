import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "The review pipeline",
  description: "One reviewer proposes findings, deterministic code decides what is published.",
};

const HEADINGS: Heading[] = [
  { id: "stages", title: "The stages" },
  { id: "scope", title: "What gets reviewed" },
  { id: "index", title: "Repository index" },
  { id: "failure", title: "Failure" },
];

export default function HowItWorksPage() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      eyebrow="How it works"
      title="The review pipeline"
      description="Every review runs the same pipeline: the reviewer proposes, and deterministic code decides what reaches your pull request."
      headings={HEADINGS}
    >
      <Section id="stages" title="The stages">
        <Bullets>
          <Bullet>
            <strong>Review.</strong> The reviewer reads the pull request through eight read-only
            tools and returns raw candidate findings. It gets at most 12 turns.
          </Bullet>
          <Bullet>
            <strong>Validate.</strong> Each candidate is checked for schema, category, file,
            line and confidence, then duplicates are dropped and the rest capped. No model is
            involved; see <Link href="/docs/trust-boundary">the trust boundary</Link>.
          </Bullet>
          <Bullet>
            <strong>Verify fixes.</strong> A proposed fix is checked against the file at the head
            commit. One that does not match is dropped, and its finding is kept without it.
          </Bullet>
          <Bullet>
            <strong>Publish.</strong> The findings become inline comments, the AI PR Review check
            run and the review on your dashboard. Verified fixes are committed or offered as
            suggestions, depending on the repository&rsquo;s{" "}
            <Link href="/docs/configuration#fixes">fixes setting</Link>.
          </Bullet>
        </Bullets>
      </Section>

      <Section id="scope" title="What gets reviewed">
        <P>
          The first review reads the whole pull request. After that, a new push is reviewed
          from the commits added since the last review. Findings from earlier reviews that
          nobody has resolved are listed on the check run, so a narrower review never reads as
          a clean one. If a force-push removes the last reviewed commit from the branch, the
          whole pull request is reviewed again.
        </P>
      </Section>

      <Section id="index" title="Repository index">
        <P>
          Before the reviewer starts, LintCat reads the repository at the pull request&rsquo;s
          base commit, never its head, so a branch cannot shape what the reviewer believes
          about the rest of the code. The reviewer is told each changed file&rsquo;s role and
          its covering test, and <code>find_references</code> answers from the same index. It
          is discarded when the review ends. If it cannot be built, the review runs without it.
        </P>
      </Section>

      <Section id="failure" title="Failure">
        <P>
          A failed review is retried automatically. Once the retries run out, the AI PR Review
          check run fails and says so, and nothing from that review is published. Push a commit
          or re-add the <code>ai-review</code> label to try again.
        </P>
        <P>
          A model that isn&rsquo;t recognised is not retried, because every attempt would fail
          the same way. The check run names the problem, and a repository owner can change the
          model in the repository&rsquo;s settings.
        </P>
      </Section>
    </DocsArticle>
  );
}
