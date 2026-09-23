import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "How LintCat works",
  description: "What LintCat reads, what it looks for, and what makes it different.",
};

const HEADINGS: Heading[] = [
  { id: "review", title: "How a review works" },
  { id: "looks-for", title: "What it looks for" },
  { id: "in-line", title: "Keeping the codebase in line" },
  { id: "different", title: "How it's different" },
];

export default function HowItWorksPage() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      eyebrow="How it works"
      title="How LintCat works"
      description="LintCat reads a pull request the way a careful reviewer would: the diff, the code around it, and the parts of the repository it touches."
      headings={HEADINGS}
    >
      <Section id="review" title="How a review works">
        <Bullets>
          <Bullet>
            <strong>Read.</strong> The reviewer starts from the diff, then opens the surrounding
            code, the previous version of each file, the files that import it and the tests that
            cover it.
          </Bullet>
          <Bullet>
            <strong>Propose.</strong> It returns candidate findings, each tied to a file, a line
            and, where it can, a fix.
          </Bullet>
          <Bullet>
            <strong>Check.</strong> LintCat drops anything that doesn&rsquo;t point at a line you
            changed, isn&rsquo;t confident enough or repeats another finding, and checks every fix
            against the current file.
          </Bullet>
          <Bullet>
            <strong>Post.</strong> What survives becomes inline comments, the AI PR Review check
            run and the review on your dashboard.
          </Bullet>
        </Bullets>
        <P>
          After the first review, a new push is reviewed from the commits added since, and
          findings nobody has resolved stay listed on the check run.
        </P>
      </Section>

      <Section id="looks-for" title="What it looks for">
        <Bullets>
          <Bullet>
            <strong>Correctness:</strong> wrong conditions or bounds, unhandled empty input,
            swallowed errors, missing awaits, ordering bugs.
          </Bullet>
          <Bullet>
            <strong>Security:</strong> missing or bypassable auth, cross-tenant access, injection,
            leaked secrets, sensitive data in logs.
          </Bullet>
          <Bullet>
            <strong>Performance:</strong> N+1 queries, unbounded reads on a request path,
            quadratic scans over growing data.
          </Bullet>
          <Bullet>
            <strong>Tests:</strong> a new branch the module&rsquo;s tests don&rsquo;t exercise, or
            a test still asserting the old behaviour.
          </Bullet>
          <Bullet>
            <strong>Documentation:</strong> a README, doc or comment the change made wrong.
          </Bullet>
        </Bullets>
        <P>
          It leaves style, formatting, naming and architectural taste to your linter and your
          team. It reports a problem only when it can say concretely what goes wrong, and when.
        </P>
      </Section>

      <Section id="in-line" title="Keeping the codebase in line">
        <P>
          A diff only shows what changed. Before the reviewer starts, LintCat maps the
          repository&rsquo;s imports, so for every changed file the reviewer already knows:
        </P>
        <Bullets>
          <Bullet>what kind of file it is, and which package owns it;</Bullet>
          <Bullet>which test covers it, or that nothing does;</Bullet>
          <Bullet>how many files import it;</Bullet>
          <Bullet>
            whether it is dead, with nothing importing it and no entry point reaching it;
          </Bullet>
          <Bullet>whether it sits in an import cycle.</Bullet>
        </Bullets>
        <P>
          It can also look up which files use a name that changed, and which files have
          historically changed alongside this one. That is how it catches the caller that
          wasn&rsquo;t updated, the test that no longer covers the code, and the doc that now
          describes something else.
        </P>
      </Section>

      <Section id="different" title="How it's different">
        <Bullets>
          <Bullet>
            <strong>Nothing unchecked reaches your pull request.</strong> Every finding and fix
            is checked before it posts. See <Link href="/docs/security">Security</Link>.
          </Bullet>
          <Bullet>
            <strong>It can&rsquo;t change your repository.</strong> The AI reviewer can only
            read. Comments, and fixes if you turn them on, are posted by LintCat after the checks.
          </Bullet>
          <Bullet>
            <strong>Fixes are proven, not guessed.</strong> A fix is only offered when the lines
            it replaces match the file exactly, so a suggestion never lands on the wrong code.
          </Bullet>
          <Bullet>
            <strong>The branch can&rsquo;t mislead it.</strong> LintCat maps your repository as it
            was before the pull request, so a change can&rsquo;t misrepresent the rest of your
            code.
          </Bullet>
          <Bullet>
            <strong>It never blocks a merge.</strong> The check run is advisory.
          </Bullet>
          <Bullet>
            <strong>Your model, nothing in CI.</strong> Install the GitHub App and add a model
            key. There is no workflow file to maintain.
          </Bullet>
        </Bullets>
      </Section>
    </DocsArticle>
  );
}
