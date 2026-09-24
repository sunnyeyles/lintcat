import { Button, Card } from "@pr-review/design";
import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, Note, P, Section } from "@/components/docs";
import { DOCS_HOME, DOCS_PAGES, type Heading, LOOKS_FOR } from "@/lib/docs";
import { INSTALL_APP_URL } from "@/lib/github-app";

export const metadata: Metadata = {
  title: "Introduction",
  description:
    "LintCat reviews your pull requests and leaves inline comments. Install the GitHub App; there is nothing to add to your CI.",
};

const HEADINGS: Heading[] = [
  { id: "what-it-does", title: "What it does" },
  { id: "getting-it", title: "Getting it on your repositories" },
  { id: "reviewer", title: "What the reviewer looks for" },
  { id: "keep-reading", title: "Keep reading" },
];

export default function IntroductionPage() {
  return (
    <DocsArticle
      href={DOCS_HOME}
      eyebrow="Documentation"
      title="LintCat"
      description="An AI reviewer that reads your pull requests and leaves inline review comments, plus an AI PR Review check run with the full summary. Install the GitHub App and add a model key. Nothing goes in your CI."
      headings={HEADINGS}
    >
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/docs/quickstart">Quickstart</Link>
        </Button>
        <Button asChild variant="outline">
          <a href={INSTALL_APP_URL}>Install the GitHub App</a>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Open the dashboard</Link>
        </Button>
      </div>

      <Section id="what-it-does" title="What it does">
        <P>
          One reviewer reads each pull request in a single pass, looking for correctness,
          security, performance, test and documentation problems. You don&rsquo;t need to
          configure anything to get that.
        </P>
        <P>
          A finding can include a <strong>suggested fix</strong>. LintCat checks the fix
          against the file at the pull request&rsquo;s latest commit before offering it, so a
          suggestion never lands on the wrong lines. Apply it with one click, or have LintCat
          commit it for you.
        </P>
      </Section>

      <Section id="getting-it" title="Getting it on your repositories">
        <P>
          Install the LintCat GitHub App on your organization or personal account, and pick
          the repositories it may review. An organization owner saves one Anthropic or OpenAI
          API key on the dashboard; reviews run on that key, so model usage is billed to
          your provider account.
        </P>
        <P>
          By default every pull request is reviewed when it is opened, and again on every
          push. Switch a repository to review only pull requests with the{" "}
          <code>ai-review</code> label, or turn it off, from its settings page. A
          new push replaces a review still in progress, so comments are always on the latest
          commit.
        </P>
        <Note title="No workflow file, no secrets in GitHub">
          Reviews run on LintCat&rsquo;s side. Your repository gets no workflow, and your
          Actions minutes go untouched.
        </Note>
      </Section>

      <Section id="reviewer" title="What the reviewer looks for">
        <Bullets>
          {LOOKS_FOR.map(([name, reviews]) => (
            <Bullet key={name}>
              <strong className="text-foreground">{name}</strong> — {reviews}
            </Bullet>
          ))}
        </Bullets>
      </Section>

      <Section id="keep-reading" title="Keep reading">
        <div className="grid gap-3 sm:grid-cols-2">
          {DOCS_PAGES.filter((page) => page.href !== DOCS_HOME).map((page) => (
            <Card key={page.href} className="transition-colors hover:border-primary">
              <Link
                href={page.href}
                className="group flex h-full flex-col gap-1.5 p-4 no-underline"
              >
                <span className="text-label font-semibold text-foreground group-hover:text-link">
                  {page.title}
                </span>
                <span className="text-caption leading-relaxed text-muted-foreground">
                  {page.summary}
                </span>
              </Link>
            </Card>
          ))}
        </div>
      </Section>
    </DocsArticle>
  );
}
