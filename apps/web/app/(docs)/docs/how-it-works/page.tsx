import type { Metadata } from "next";
import Link from "next/link";

import { Bullet, Bullets, DocsArticle, P, Section, StageFigure } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "How LintCat works",
  description: "What LintCat reads, what it looks for, and what makes it different.",
};

const STAGES = [
  { id: "stage01-webhook", title: "GitHub knocks" },
  { id: "stage02-queue", title: "One job per head" },
  { id: "stage03-boot", title: "Lease, token, key" },
  { id: "stage04-scope", title: "Only what changed since" },
  { id: "stage05-blast", title: "Trace the blast radius" },
  { id: "stage06-agent", title: "Read, then propose" },
  { id: "stage07-check", title: "Every finding checked" },
  { id: "stage08-publish", title: "Post, record, settle" },
] as const;

const HEADINGS: Heading[] = [
  { id: "review", title: "How a review works" },
  ...STAGES.map((s, i) => ({ id: s.id, title: `${i + 1}. ${s.title}` })),
  { id: "looks-for", title: "What it looks for" },
  { id: "in-line", title: "Keeping the codebase in line" },
  { id: "different", title: "How it's different" },
];

function Stage({ n, children }: { n: number; children: React.ReactNode }) {
  const stage = STAGES[n - 1];
  return (
    <Section id={stage.id} title={`${n}. ${stage.title}`}>
      <StageFigure id={stage.id} n={n} title={stage.title} />
      {children}
    </Section>
  );
}

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
        <P>
          A review runs in eight stages. Each one below is drawn step by step, in the order it
          happens; the drawings loop, and every frame is generated from code, so what you see is
          what the pipeline does.
        </P>
        <P>
          After the first review, a new push is reviewed from the commits added since, and
          findings nobody has resolved stay listed on the check run.
        </P>
      </Section>

      <Stage n={1}>
        <P>
          GitHub sends a <code>pull_request</code> event to LintCat&rsquo;s webhook. The request is
          checked three ways before anything runs: the HMAC signature over the raw body, the shape
          of the payload, and the repository&rsquo;s review mode. A repository set to{" "}
          <em>label</em> is reviewed only when the pull request carries the{" "}
          <code>ai-review</code> label.
        </P>
      </Stage>

      <Stage n={2}>
        <P>
          One job is queued per head commit. A newer push to the same pull request supersedes the
          older job, and a repeat delivery of the same event is a no-op. The web app pings the
          worker, a scheduler sweeps for anything a ping missed, and the worker claims one job at a
          time.
        </P>
      </Stage>

      <Stage n={3}>
        <P>
          Before the first model call the worker renews its lease on a heartbeat, mints a GitHub
          App installation token, confirms the head has not moved, decrypts your organisation&rsquo;s
          model key and picks the provider and model. With no key it posts a neutral check run
          asking for one, and stops.
        </P>
      </Stage>

      <Stage n={4}>
        <P>
          The pull request, its changed files and its diff are fetched in parallel. The baseline
          is the last commit that already carries LintCat&rsquo;s check run: only files changed
          since then are reviewed, and any doubt widens the scope back to the whole pull request.
          Findings nobody resolved are carried forward.
        </P>
      </Stage>

      <Stage n={5}>
        <P>
          The repository is indexed at the base commit from a single tarball: what each file is,
          which test covers it, the import graph, cycles and entry points. From every changed
          file the blast radius walks importers up to three hops out, flags untested sources,
          broken importers and cycles, and scores the risk from 0 to 100. The score and the graph
          appear on the check run and on the dashboard.
        </P>
      </Stage>

      <Stage n={6}>
        <P>
          One reviewer agent receives the repository summary, the index, the imports and the diff,
          and eight read-only tools for opening files, searching, and finding references. It has
          at most twelve turns, and its final answer must be JSON that parses. In parallel,
          reviewer suggestions come from blame at the base commit and CODEOWNERS.
        </P>
      </Stage>

      <Stage n={7}>
        <P>
          Everything the model proposed is untrusted until checked. A finding survives only if it
          has the right shape, stays in its own category, points at a file in the pull request and
          a line that was added, is confident enough and is not a duplicate; at most ten are kept.
          A fix is kept only when the lines it replaces match the file at head byte for byte.
        </P>
      </Stage>

      <Stage n={8}>
        <P>
          Rendering is a pure step with no I/O. Writes go in order: a fast-forward fix commit if
          fixes are on, then inline comments, then the check run, which is always neutral and
          never blocks a merge. The review, its findings, the risk and the graph snapshot are
          recorded for the dashboard, and the job is marked complete, superseded, retried or failed.
        </P>
      </Stage>

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
