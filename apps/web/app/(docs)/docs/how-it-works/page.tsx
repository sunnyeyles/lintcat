import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, HowItWorksLoop, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "How LintCat works",
  description: "What LintCat reads, what it looks for, and what makes it different.",
  alternates: { canonical: "/docs/how-it-works" },
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
        <HowItWorksLoop />
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
            changed, isn&rsquo;t confident enough or repeats another finding, removes any cited
            example of your conventions that doesn&rsquo;t exist, and checks every fix against the
            current file.
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
        <P>
          Drift: places where a change departs from how the rest of your repository already
          does the same thing. The code may work; the next reader now finds two conventions
          where there was one.
        </P>
        <Bullets>
          <Bullet>
            <strong>Naming:</strong> a function, type, file or export named differently from how
            its neighbours name the same kind of thing.
          </Bullet>
          <Bullet>
            <strong>Patterns:</strong> a helper written again when the repository already has
            one, a layer the other files go through and this one skips.
          </Bullet>
          <Bullet>
            <strong>Style:</strong> export style, error shapes or module layout the neighbouring
            files share and no formatter or linter enforces.
          </Bullet>
          <Bullet>
            <strong>Documentation:</strong> a README, doc or comment the change made wrong, and
            a doc link the change adds to a file or heading that doesn&rsquo;t exist. Broken links
            are found by LintCat itself, not the AI, so they need no cited examples. Rewording
            that makes a doc say less is not drift.
          </Bullet>
          <Bullet>
            <strong>Config:</strong> a setting or dependency added differently from the ones
            already there, such as an environment variable your <code>.env.example</code> and docs
            don&rsquo;t list, or a second library for a job one you already use does.
          </Bullet>
        </Bullets>
        <P>
          Every finding cites at least two places in your existing code that show the
          convention, one line of your CLAUDE.md, AGENTS.md or CONTRIBUTING.md that states it,
          or a count of the neighbouring files that follow it, and each is checked before the
          finding posts. Where the existing files disagree among themselves and no rule doc
          settles it, there is no convention, and nothing is reported.
        </P>
        <P>
          Bugs, security holes and performance problems are outside its scope, and so is
          anything your formatter, linter, typecheck or build already catches. The reviewer
          reads your lint and format configuration to know what that is.
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
          <Bullet>whether it sits in an import cycle;</Bullet>
          <Bullet>
            which unchanged files sit beside it and play the same role: the local convention it
            is compared against;
          </Bullet>
          <Bullet>
            which conventions those files clearly share, counted rather than guessed: how they
            name files and tests, how they export, and how they import;
          </Bullet>
          <Bullet>
            which lines of your Markdown docs name something the change edits or removes;
          </Bullet>
          <Bullet>
            which new environment variables nothing documents, and which new dependencies
            duplicate one you already use;
          </Bullet>
          <Bullet>
            what your CLAUDE.md, AGENTS.md and CONTRIBUTING.md say, and which linter, formatter
            and typecheck settings apply to it, as they stand on your base branch.
          </Bullet>
        </Bullets>
        <P>
          It can also look up which files use a name, and which files have historically
          changed alongside this one. That is how it finds the helper the change wrote again,
          the convention three other files follow, and the doc that now describes something
          else.
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
