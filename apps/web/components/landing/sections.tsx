import { Button, Card, Spotlight } from "@pr-review/design";
import {
  BookOpen,
  Bot,
  Bug,
  FlaskConical,
  Gauge,
  GitPullRequest,
  type LucideIcon,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DOCS_HOME, LOOKS_FOR } from "@/lib/docs";
import { INSTALL_APP_URL } from "@/lib/github-app";

function Block({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl font-display text-h1 font-bold tracking-display">{title}</h2>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

const AGENT_TOOLS = [
  ["review_local_changes", "Review the working tree against its base branch."],
  ["repository_overview", "Workspace packages and import coverage, from the working tree."],
  ["find_references", "Which files import a file, or one of its exports."],
  ["describe_file", "A file's role, its package, its importers and its test."],
] as const;

function Audience({
  icon: Icon,
  title,
  lede,
  children,
}: {
  icon: LucideIcon;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-4 p-6">
      <div className="flex size-10 items-center justify-center rounded-md bg-accent text-link">
        <Icon className="size-5" />
      </div>
      <h3 className="text-h3 font-semibold">{title}</h3>
      <p className="text-body text-muted-foreground">{lede}</p>
      {children}
    </Card>
  );
}

export function Audiences() {
  return (
    <Block eyebrow="Two ways in" title="One index, read by your team and by your agent.">
      <div className="grid gap-4 md:grid-cols-2">
        <Audience
          icon={GitPullRequest}
          title="For your team"
          lede="Install the GitHub App and label a pull request. LintCat leaves inline comments, an AI PR Review check run, and a record on your dashboard."
        >
          <ul className="grid gap-2 border-t border-border pt-4 text-label text-muted-foreground">
            <li>Suggested fixes, checked against the latest commit</li>
            <li>Findings by severity and category, across every repository</li>
            <li>A codebase map for each review: what changed, and what depends on it</li>
          </ul>
        </Audience>
        <Audience
          icon={Bot}
          title="For your coding agent"
          lede="Run the same reviewer as an MCP server in Claude Code or any MCP client. Your agent reviews its own work before it pushes, and asks the index how the code fits together."
        >
          <dl className="mt-auto grid gap-2 rounded-md border border-border bg-surface-2 p-3">
            {AGENT_TOOLS.map(([tool, does]) => (
              <div key={tool} className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
                <dt className="font-mono text-caption text-link">{tool}</dt>
                <dd className="text-caption text-muted-foreground">{does}</dd>
              </div>
            ))}
          </dl>
        </Audience>
      </div>
    </Block>
  );
}

const CATEGORY_ICON: Record<(typeof LOOKS_FOR)[number][0], LucideIcon> = {
  Correctness: Bug,
  Security: ShieldCheck,
  Performance: Gauge,
  Tests: FlaskConical,
  Documentation: BookOpen,
};

export function Findings() {
  return (
    <Block
      eyebrow="What it looks for"
      title="Problems a careful reviewer would raise, and nothing else."
      className="border-t border-border"
    >
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
        {LOOKS_FOR.map(([name, reviews]) => {
          const Icon = CATEGORY_ICON[name];
          return (
            <div key={name} className="flex flex-col gap-2 bg-background p-5">
              <Icon className="size-5 text-link" />
              <h3 className="text-label font-semibold">{name}</h3>
              <p className="text-caption leading-relaxed text-muted-foreground">{reviews}</p>
            </div>
          );
        })}
      </div>
    </Block>
  );
}

const STEPS = [
  ["Install the GitHub App", "Pick the repositories LintCat may review. Nothing goes in your CI."],
  ["Add a model key", "An owner saves an Anthropic or OpenAI key. Reviews bill to your provider."],
  [
    "Label a pull request",
    <>
      Add <code className="font-mono">ai-review</code>. Every later push is reviewed again.
    </>,
  ],
] as const satisfies readonly (readonly [string, ReactNode])[];

export function Steps() {
  return (
    <Block
      eyebrow="Getting started"
      title="Three steps, no workflow file."
      className="border-t border-border"
    >
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(([title, body], index) => (
          <li key={title} className="flex gap-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-mono text-label text-link">
              {index + 1}
            </span>
            <div className="grid gap-1">
              <h3 className="text-body font-semibold">{title}</h3>
              <p className="text-label text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-label">
        <Link href="/docs/quickstart" className="text-link">
          Read the quickstart
        </Link>
        <Link href="/docs/how-it-works" className="text-link">
          How a review works
        </Link>
      </div>
    </Block>
  );
}

export function ClosingCta() {
  return (
    <section className="relative isolate overflow-hidden border-t border-border">
      <Spotlight className="-z-10 opacity-70" translateY={-500} xOffset={60} />
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-8">
        <h2 className="max-w-2xl font-display text-h1 font-bold tracking-display">
          Give your next pull request a second pair of eyes.
        </h2>
        <p className="mt-3 max-w-xl text-lede text-muted-foreground">
          Install it on one repository or all of them. You bring the model key.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <a href={INSTALL_APP_URL}>Install the GitHub App</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={DOCS_HOME}>Read the docs</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
