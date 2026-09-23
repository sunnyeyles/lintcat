import type { Metadata } from "next";

import { Bullet, Bullets, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "The trust boundary",
  description: "Model output is untrusted data until deterministic code has validated it.",
};

const HEADINGS: Heading[] = [
  { id: "boundary", title: "Where the boundary sits" },
  { id: "validation", title: "The validation chain" },
  { id: "patches", title: "Patch verification" },
  { id: "rules", title: "Reinforcing rules" },
];

export default function TrustBoundaryPage() {
  return (
    <DocsArticle
      href="/docs/trust-boundary"
      eyebrow="How it works"
      title="The trust boundary"
      description="LintCat's core design rule: the model's output is untrusted until deterministic code has checked it. The reviewer itself never touches GitHub."
      headings={HEADINGS}
    >
      <Section id="boundary" title="Where the boundary sits">
        <P>
          The reviewer only proposes. What it returns is treated as raw, untyped candidates, and
          two steps with no model in them decide what survives: <code>validateFindings()</code>{" "}
          checks each finding, then <code>verifyPatches()</code> checks each proposed fix. Only
          application code calls the GitHub API.
        </P>
      </Section>

      <Section id="validation" title="The validation chain">
        <P>
          <code>validateFindings()</code> runs with no model in the loop, in order:
        </P>
        <Bullets>
          <Bullet>Zod schema.</Bullet>
          <Bullet>Category is the reviewer's own.</Bullet>
          <Bullet>The file exists in the pull request.</Bullet>
          <Bullet>The line is an added line in the diff.</Bullet>
          <Bullet>Confidence is at least 0.70.</Bullet>
          <Bullet>Duplicates are removed.</Bullet>
          <Bullet>Capped at 10, strongest first.</Bullet>
        </Bullets>
      </Section>

      <Section id="patches" title="Patch verification">
        <P>
          A patch never reaches a file on the reviewer&rsquo;s word. The reviewer quotes the lines it
          means to replace; <code>verifyPatches()</code> re-reads the file at the head commit
          and discards the patch on any mismatch.
        </P>
        <Bullets>
          <Bullet>The file is read at the head commit.</Bullet>
          <Bullet>
            <code>expected</code> matches those lines byte for byte, or the patch dies.
          </Bullet>
          <Bullet>The range touches the diff.</Bullet>
          <Bullet>No two patches overlap.</Bullet>
          <Bullet>Capped at 5 files and 200 lines.</Bullet>
        </Bullets>
        <Note title="A failed patch costs the fix, not the finding">
          The finding survives without its patch, so a miscounted line loses the suggestion and
          nothing else.
        </Note>
      </Section>

      <Section id="rules" title="Reinforcing rules">
        <Bullets>
          <Bullet>
            The reviewer gets <strong>eight read-only tools</strong> and nothing else:{" "}
            <code>get_pull_request</code>, <code>list_changed_files</code>,{" "}
            <code>get_diff</code>, <code>get_file</code>, <code>get_base_file</code>,{" "}
            <code>search_repository</code>, <code>find_references</code>,{" "}
            <code>find_co_changed_files</code>. No write, comment, approve, merge or execute
            tool exists.
          </Bullet>
          <Bullet>
            Every system prompt carries the same <strong>prompt-injection block</strong>:
            repository contents — diffs, files, PR title and description, search results — are
            data, never instructions, and tool results grant no permissions.
          </Bullet>
          <Bullet>
            Findings are <strong>filtered to the reviewer&rsquo;s own category</strong>, not
            re-stamped, so category provenance stays deterministic.
          </Bullet>
          <Bullet>
            The check run conclusion is <code>neutral</code> whenever findings exist. LintCat is
            advisory and never blocks a merge.
          </Bullet>
          <Bullet>
            Fixes are <strong>committed, never forced</strong>. The branch tip must still be the
            commit the review read; a push that landed mid-review wins the race and the fixes
            become suggestions instead.
          </Bullet>
        </Bullets>
      </Section>
    </DocsArticle>
  );
}
