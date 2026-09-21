import { Button, Card } from "@pr-review/design";
import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, Code, DocsArticle, Note, P, Section } from "@/components/docs";
import { DOCS_HOME, DOCS_PAGES, type Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Introduction",
  description:
    "AI agents review your pull requests and publish inline comments; deterministic code decides what reaches GitHub.",
};

const HEADINGS: Heading[] = [
  { id: "what-it-does", title: "What it does" },
  { id: "delivery", title: "Delivery path" },
  { id: "pipeline", title: "How a review happens" },
  { id: "agents", title: "The agents that ship" },
  { id: "keep-reading", title: "Keep reading" },
];

const PIPELINE = `GitHub PR event (opened / synchronize / reopened)
   │
   ▼
GitHub Action
   │
   ├── authenticate with the workflow token
   ├── load PR, changed files, diff
   ├── build the repository index at the base commit
   │
   ▼
Review pipeline
   │
   ├─ agent__<agent 1>  ─┐
   ├─ agent__<agent 2>   ├─► join ─► synthesise ─► validate ─► END
   └─ agent__<agent n>  ─┘
                                    │
                                    ▼
                    GitHub Check Run + inline comments
                      (or job summary, on a fork PR)`;

const AGENTS = [
  ["general", "The default: everything below, in one pass"],
  ["security", "Auth, cross-tenant access, injection, secret leakage, privilege"],
  ["correctness", "Logic errors, wrong bounds, unhandled null, broken error handling"],
  ["performance", "N+1 queries, unbounded reads, quadratic scans, blocking I/O"],
  ["test-coverage", "Branches this change adds or changes and leaves untested"],
  ["docs-drift", "Documentation this change made wrong"],
] as const;

export default function IntroductionPage() {
  return (
    <DocsArticle
      href={DOCS_HOME}
      eyebrow="Documentation"
      title="pr-review-agents"
      description="AI agents review a pull request and publish the result as inline review comments, alongside an AI PR Review check run carrying the full summary. The agents never touch GitHub — deterministic code decides what gets published."
      headings={HEADINGS}
    >
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/docs/quickstart">Quickstart</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Open the dashboard</Link>
        </Button>
      </div>

      <Section id="what-it-does" title="What it does">
        <P>
          One <strong>general</strong> agent reviews every pull request for correctness,
          security, performance, test and documentation problems in a single pass. No
          configuration is needed to get that.
        </P>
        <P>
          Specialist agents are opt-in. Five ship with the action; a repository that names
          them in <code>.github/pr-review-agents.yml</code> gets a review from exactly those,
          run in parallel and merged by a synthesiser.
        </P>
        <P>
          A finding may carry a <strong>patch</strong>: a replacement for a range of lines,
          quoted alongside the exact text it expects to replace. Application code checks that
          quote against the file at the head commit character for character before the patch
          goes anywhere.
        </P>
      </Section>

      <Section id="delivery" title="Delivery path">
        <P>
          A GitHub Action, run in your repository&rsquo;s own Actions runner. There is no
          infrastructure to stand up and no GitHub App to register for the review itself —
          the workflow&rsquo;s own token authenticates the reads and publishes the check run.
          The dashboard is the one part that installs an App, to read your organization.
        </P>
        <Code caption=".github/workflows/ai-review.yml">{`- uses: sunnyeyles/pr-review-action@v2
  with:
    api-key: \${{ secrets.OPENAI_API_KEY }}`}</Code>
        <Note title="Fork pull requests">
          A fork&rsquo;s <code>GITHUB_TOKEN</code> is read-only and cannot create a check run.
          The Action detects that, writes the review into the job summary instead, and still
          exits 0.
        </Note>
      </Section>

      <Section id="pipeline" title="How a review happens">
        <Code>{PIPELINE}</Code>
        <P>
          Agents are started together, so they run concurrently. One failed agent does not
          fail the review: results are collected in the agents&rsquo; original order and what
          succeeded is published.
        </P>
      </Section>

      <Section id="agents" title="The agents that ship">
        <Bullets>
          {AGENTS.map(([name, reviews]) => (
            <Bullet key={name}>
              <code className="text-ink">{name}</code> — {reviews}
            </Bullet>
          ))}
        </Bullets>
        <P>
          An agent&rsquo;s name is also the finding category it owns, and the only category
          its findings may carry.
        </P>
      </Section>

      <Section id="keep-reading" title="Keep reading">
        <div className="grid gap-3 sm:grid-cols-2">
          {DOCS_PAGES.filter((page) => page.href !== DOCS_HOME).map((page) => (
            <Card key={page.href} className="transition-colors hover:border-accent">
              <Link
                href={page.href}
                className="group flex h-full flex-col gap-1.5 p-4 no-underline"
              >
                <span className="font-mono text-label font-semibold text-ink group-hover:text-accent">
                  {page.title}
                </span>
                <span className="font-mono text-caption leading-relaxed text-slate">
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
