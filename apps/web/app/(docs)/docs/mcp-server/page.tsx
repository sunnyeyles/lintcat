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

import { DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "MCP server",
  description: "Run the reviewer over a working tree, inside your coding agent, before you push.",
};

const HEADINGS: Heading[] = [
  { id: "running", title: "Running it" },
  { id: "tools", title: "Tools" },
  { id: "same-path", title: "The same path as the Action" },
];

const TOOLS = [
  ["list_review_agents", "Lists the agents a checkout configures, each one's category and path gate, and which the working tree's changes would wake. No model key needed."],
  ["review_local_changes", "Reviews the working tree against its base branch — commits since the merge-base plus uncommitted and untracked files — before anything is pushed."],
  ["review_pull_request", "Reviews a GitHub pull request; a dry run unless publish: true, which posts the check run and comments as the Action would."],
  ["repository_overview, find_references, describe_file", "The repository index, built from the working tree, with no network."],
  ["validate_agent_config", "Checks a checkout's .github/pr-review-agents.yml and reports what it resolves to, or where it is wrong. No model calls."],
  ["list_reviews, get_review, review_trends", "Stored review history, scoped by the dashboard's own access rules to your GitHub account."],
] as const;

export default function McpServerPage() {
  return (
    <DocsArticle
      href="/docs/mcp-server"
      eyebrow="Reference"
      title="MCP server"
      description="Runs the reviewer inside a coding agent such as Claude Code, over local stdio, so a change is reviewed before it is pushed."
      headings={HEADINGS}
    >
      <Section id="running" title="Running it">
        <P>
          Register it in any MCP client as a local stdio server named{" "}
          <code>pr-review</code>. It needs an <code>ANTHROPIC_API_KEY</code> or{" "}
          <code>OPENAI_API_KEY</code>; GitHub access uses <code>GITHUB_TOKEN</code> or the{" "}
          <code>gh</code> login.
        </P>
      </Section>

      <Section id="tools" title="Tools">
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">
              The tools the MCP server exposes, and what each one does.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Tool</TableHead>
                <TableHead scope="col">What it does</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TOOLS.map(([tool, purpose]) => (
                <TableRow key={tool}>
                  <TableCell className="font-mono text-ink">{tool}</TableCell>
                  <TableCell className="text-slate">{purpose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Note title="Cancelling is honoured">
          Ctrl-C in the client, or any <code>notifications/cancelled</code>, aborts the
          agents&rsquo; model calls — and a cancelled run publishes nothing.
        </Note>
      </Section>

      <Section id="same-path" title="The same path as the Action">
        <P>
          A local review takes the same path, with a git-backed client in place of
          GitHub&rsquo;s, so the trust boundary is unchanged: the agent configuration is read
          at the base commit, and only validated findings come back.
        </P>
      </Section>
    </DocsArticle>
  );
}
