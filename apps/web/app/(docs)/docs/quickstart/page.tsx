import { Button } from "@pr-review/design";
import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, Note, P, Section } from "@/components/docs";
import { docsHeadings } from "@/lib/docs";
import { INSTALL_APP_URL } from "@/lib/github-app";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Install the GitHub App, add a model key, and label a pull request.",
};

const [H, HEADINGS] = docsHeadings({
  install: "1. Install the GitHub App",
  key: "2. Add a model key",
  review: "3. Review a pull request",
  result: "What lands on the pull request",
});

export default function QuickstartPage() {
  return (
    <DocsArticle
      href="/docs/quickstart"
      eyebrow="Start here"
      title="Quickstart"
      description="Three steps, a few minutes, and nothing to commit to your repository."
      headings={HEADINGS}
    >
      <Section {...H.install}>
        <P>
          Install LintCat on your personal GitHub account or on an organization, and choose
          all repositories or only some. You don&rsquo;t need an organization: your own
          account works on its own. GitHub then sends you back to the dashboard, signed in,
          with the account set up.
        </P>
        <Button asChild>
          <a href={INSTALL_APP_URL}>Install the GitHub App</a>
        </Button>
        <Note title="Not an owner?">
          If you install on an organization you don&rsquo;t own, GitHub sends the install to
          an owner to approve. Once they do, sign in again and the organization shows up.
        </Note>
      </Section>

      <Section {...H.key}>
        <P>
          On the dashboard, open <strong>Settings</strong> in the sidebar, pick Anthropic or
          OpenAI and paste an API key. Only owners of the account see this page. The key is
          stored encrypted and never shown again; the dashboard shows only its last four
          characters.
        </P>
        <P>
          Until a key is saved, a pull request that would be reviewed gets a neutral check run
          asking an owner to add one, and no model is called.
        </P>
      </Section>

      <Section {...H.review}>
        <P>
          Open a pull request on an installed repository. The review runs in the background
          and posts when it finishes, and every later push to that pull request is reviewed
          again.
        </P>
        <P>
          To review only the pull requests you pick, switch the repository to the{" "}
          <code>ai-review</code> label on its settings page. See{" "}
          <Link href="/docs/configuration">Configuration</Link>.
        </P>
      </Section>

      <Section {...H.result}>
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
