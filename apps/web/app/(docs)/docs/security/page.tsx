import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Security",
  description: "What LintCat can access, what it never does, and how it keeps noise off your pull requests.",
};

const HEADINGS: Heading[] = [
  { id: "access", title: "What LintCat can access" },
  { id: "never", title: "What it never does" },
  { id: "quality", title: "Only findings worth reading" },
  { id: "fixes", title: "Fixes you can trust" },
  { id: "injection", title: "Prompt injection" },
];

export default function SecurityPage() {
  return (
    <DocsArticle
      href="/docs/security"
      eyebrow="How it works"
      title="Security"
      description="LintCat reads your code to review it, and that is all the AI part can do. Everything it posts is checked first, and it never approves, merges or blocks anything."
      headings={HEADINGS}
    >
      <Section id="access" title="What LintCat can access">
        <Bullets>
          <Bullet>
            <strong>Only the repositories you pick</strong> when you install the GitHub App. The
            permissions it asks for, and why, are listed under{" "}
            <Link href="/docs/configuration#permissions">Configuration</Link>.
          </Bullet>
          <Bullet>
            <strong>Your model provider sees the code it reviews.</strong> Reviews run on your
            organization&rsquo;s own Anthropic or OpenAI key, under your agreement with that
            provider.
          </Bullet>
          <Bullet>
            <strong>Your key stays encrypted.</strong> Only the review service reads it back;
            the dashboard shows its last four characters and nothing more.
          </Bullet>
        </Bullets>
      </Section>

      <Section id="never" title="What it never does">
        <Bullets>
          <Bullet>
            <strong>The AI reviewer can only read.</strong> It can look through your code but
            has no way to comment, commit, approve or merge. Posting the review is done by
            LintCat itself, after the checks below.
          </Bullet>
          <Bullet>
            <strong>It never blocks a merge.</strong> The AI PR Review check is advisory, and
            its conclusion is <code>neutral</code> when there are findings.
          </Bullet>
          <Bullet>
            <strong>It never force-pushes.</strong> Fixes are committed only when you turn that
            on, and only if nobody pushed while the review ran. Otherwise they arrive as
            suggestions.
          </Bullet>
        </Bullets>
      </Section>

      <Section id="quality" title="Only findings worth reading">
        <P>Before anything is posted, every finding has to pass these checks:</P>
        <Bullets>
          <Bullet>It points at a line this pull request added or changed.</Bullet>
          <Bullet>The reviewer is confident in it.</Bullet>
          <Bullet>It doesn&rsquo;t repeat another finding.</Bullet>
          <Bullet>It makes the cut of at most 10 per review, most important first.</Bullet>
        </Bullets>
      </Section>

      <Section id="fixes" title="Fixes you can trust">
        <P>
          A suggested fix is offered only when the lines it replaces match the file at the pull
          request&rsquo;s latest commit exactly, so it never lands on the wrong code. Fixes stay
          inside the changed code and small enough to review at a glance.
        </P>
        <Note title="A bad fix doesn't cost the finding">
          If a fix doesn&rsquo;t check out, you still get the comment, just without the
          suggestion.
        </Note>
      </Section>

      <Section id="injection" title="Prompt injection">
        <P>
          Pull requests can contain text written to steer an AI. LintCat treats everything in
          the repository, including the title, description, diff and files, as code to review
          and never as instructions. And since the reviewer can only read, text like that has
          nothing it could make LintCat do.
        </P>
      </Section>
    </DocsArticle>
  );
}
