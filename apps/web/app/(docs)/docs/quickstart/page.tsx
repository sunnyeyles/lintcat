import { Button } from "@pr-review/design";
import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";
import { installAppUrl } from "@/lib/github-app";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Install the GitHub App, add a model key, and label a pull request.",
};

const HEADINGS: Heading[] = [
  { id: "install", title: "1. Install the GitHub App" },
  { id: "key", title: "2. Add a model key" },
  { id: "review", title: "3. Review a pull request" },
  { id: "result", title: "What lands on the pull request" },
];

export default function QuickstartPage() {
  const install = installAppUrl();
  return (
    <DocsArticle
      href="/docs/quickstart"
      eyebrow="Start here"
      title="Quickstart"
      description="Three steps, a few minutes, and nothing to commit to your repository."
      headings={HEADINGS}
    >
      <Section id="install" title="1. Install the GitHub App">
        <P>
          Install LintCat on your GitHub organization or personal account, and choose all
          repositories or only some. GitHub then sends you back to the dashboard, signed in,
          with your organization set up.
        </P>
        {install ? (
          <Button asChild>
            <a href={install}>Install the GitHub App</a>
          </Button>
        ) : null}
        <Note title="Not an owner?">
          If you aren&rsquo;t an owner of the organization, GitHub sends the install to an
          owner to approve. Once they do, sign in again and the organization shows up.
        </Note>
      </Section>

      <Section id="key" title="2. Add a model key">
        <P>
          On the dashboard, open <strong>Settings</strong> in the sidebar, pick Anthropic or
          OpenAI and paste an API key. Only organization owners see this page. The key is
          stored encrypted and never shown again; the dashboard shows only its last four
          characters.
        </P>
        <P>
          Until a key is saved, a pull request that would be reviewed gets a neutral check run
          asking an owner to add one, and no model is called.
        </P>
      </Section>

      <Section id="review" title="3. Review a pull request">
        <P>
          Add the <code>ai-review</code> label to any open pull request on an installed
          repository. The review runs in the background and posts when it finishes. Every
          later push to that pull request is reviewed again. If the repository has no{" "}
          <code>ai-review</code> label yet, create one under <strong>Issues → Labels</strong>.
        </P>
        <P>
          To review every pull request without a label, change the repository&rsquo;s mode on
          its settings page. See <Link href="/docs/configuration">Configuration</Link>.
        </P>
      </Section>

      <Section id="result" title="What lands on the pull request">
        <Bullets>
          <Bullet>
            Inline review comments on the lines the findings point at, one per finding.
          </Bullet>
          <Bullet>
            An <code>AI PR Review</code> check run with the full summary. Its conclusion is{" "}
            <code>neutral</code> whenever there are findings. The review is advisory and never
            blocks a merge.
          </Bullet>
          <Bullet>
            One-click suggested changes wherever a finding carried a fix that checked out
            against the latest commit.
          </Bullet>
          <Bullet>The review, its findings and its token spend, on your dashboard.</Bullet>
        </Bullets>
      </Section>
    </DocsArticle>
  );
}
