import {
  Card,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import type { Metadata } from "next";

import { Code, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Configuration",
  description: "Every Action input, the providers, fixes, and what each token permission buys.",
};

const HEADINGS: Heading[] = [
  { id: "inputs", title: "Action inputs" },
  { id: "providers", title: "Model providers" },
  { id: "fixes", title: "Fixes" },
  { id: "permissions", title: "Token permissions" },
];

const INPUTS = [
  ["api-key", "yes", "Key for the selected provider. Store as a secret; falls back to OPENAI_API_KEY or ANTHROPIC_API_KEY when empty."],
  ["model-provider", "openai", "Which provider the agents and synthesiser call: openai or anthropic. An unknown name fails the step before any model call."],
  ["github-token", "github.token", "Token for the eight read-only repository tools and for publishing the check run."],
  ["model", "provider default", "Default model id, as the provider spells it. An agent may override it; the synthesiser always uses this one."],
  ["model-base-url", "provider host", "Points a provider at a gateway, a proxy, or a compatible endpoint."],
  ["agents", "all", "Which configured agents run: all, or a comma-separated subset. A subset also overrides path filters."],
  ["agent-config", ".github/pr-review-agents.yml", "Path to the YAML file naming the agents. Without it, the general agent reviews alone."],
  ["incremental", "false", "Read only the commits added since this pull request was last reviewed."],
  ["index", "true", "Build the repository index from the base commit before the agents start."],
  ["fix", "false", "Commit verified fixes to the pull request branch. Needs contents: write."],
  ["memory-branch", "(off)", "Branch the action stores review memory on. Needs contents: write and closed in the workflow's types."],
  ["langfuse-public-key", "(unset)", "With the secret key, fetches agent prompts from Langfuse and exports traces there."],
  ["langfuse-secret-key", "(unset)", "The other half. Setting only one disables both features."],
  ["langfuse-base-url", "cloud.langfuse.com", "Langfuse host, for a self-hosted or regional instance. Keys are region-scoped."],
  ["langfuse-prompt-label", "production", "Which labelled version of each prompt to fetch."],
] as const;

const PERMISSIONS = [
  ["contents: read", "Reads files at the head and base commits, and the agent configuration", "The action cannot run"],
  ["pull-requests: write", "Findings post as inline review comments", "The check run annotates the same lines instead"],
  ["checks: write", "Publishes the AI PR Review check run and its annotations", "The review is written to the job summary instead"],
  ["contents: write", "Commits verified fixes when fix: true", "The same fixes are offered as suggested changes"],
] as const;

export default function ConfigurationPage() {
  return (
    <DocsArticle
      href="/docs/configuration"
      eyebrow="Reference"
      title="Configuration"
      description="Everything is set as with: inputs on the Action step. Only api-key has no usable default."
      headings={HEADINGS}
    >
      <Section id="inputs" title="Action inputs">
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">
              Action inputs, their defaults and what each one does.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Input</TableHead>
                <TableHead scope="col">Default</TableHead>
                <TableHead scope="col">Purpose</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {INPUTS.map(([input, fallback, purpose]) => (
                <TableRow key={input}>
                  <TableCell className="font-mono whitespace-nowrap text-ink">{input}</TableCell>
                  <TableCell className="font-mono whitespace-nowrap text-slate">
                    {fallback}
                  </TableCell>
                  <TableCell className="text-slate">{purpose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section id="providers" title="Model providers">
        <P>
          Models are reached through the AI SDK. Which providers are allowed, each one&rsquo;s
          default model, and which environment variable carries its key live in{" "}
          <code>packages/ai/src/model.ts</code>, selected by <code>model-provider</code>.
        </P>
        <Code caption="Switching provider">{`with:
  model-provider: anthropic
  api-key: \${{ secrets.ANTHROPIC_API_KEY }}
  model: claude-sonnet-5`}</Code>
        <Note title="Prompt caching is Anthropic-only">
          It is the provider whose API takes explicit cache breakpoints. On{" "}
          <code>openai</code> the two cache counters stay at zero; that is expected, not a
          regression.
        </Note>
      </Section>

      <Section id="fixes" title="Fixes">
        <P>
          With <code>fix: true</code> the surviving patches are committed to the pull request
          branch in one commit; otherwise — and whenever the commit cannot be made — they
          arrive as one-click suggested changes on the review comments.
        </P>
        <P>
          The commit is authored by <code>github-actions[bot]</code> and carries a marker line.
          A push made with <code>GITHUB_TOKEN</code> does not trigger workflows, so the review
          does not re-run itself; with a PAT that does, the marker is the second guard — a run
          whose head commit is one of ours reviews as normal but fixes nothing.
        </P>
      </Section>

      <Section id="permissions" title="Token permissions">
        <P>
          Every permission degrades rather than fails, except the first. Write access to file
          contents is requested only for <code>fix: true</code>; merges and approvals never.
        </P>
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">
              What each workflow token permission buys, and what happens without it.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Permission</TableHead>
                <TableHead scope="col">With it</TableHead>
                <TableHead scope="col">Without it</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map(([permission, granted, withheld]) => (
                <TableRow key={permission}>
                  <TableCell className="font-mono whitespace-nowrap text-ink">
                    {permission}
                  </TableCell>
                  <TableCell className="text-slate">{granted}</TableCell>
                  <TableCell className="text-slate">{withheld}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <P>
          A fork-triggered workflow gets a read-only token, so both degradations fire at once
          and the review lands in the job summary. The step still exits 0.
        </P>
      </Section>
    </DocsArticle>
  );
}
