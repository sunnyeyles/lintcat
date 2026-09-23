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
  { id: "same-path", title: "The same review as the App" },
];

const TOOLS = [
  ["review_local_changes", "Reviews the working tree against its base branch — commits since the merge-base plus uncommitted and untracked files — before anything is pushed."],
  ["review_pull_request", "Reviews a GitHub pull request; a dry run unless publish: true, which posts the check run and comments as the GitHub App would."],
  ["repository_overview, find_references, describe_file", "The repository index, built from the working tree, with no network."],
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
                  <TableCell className="font-mono text-foreground">{tool}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{purpose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Note title="You can cancel">
          Cancelling in your client stops the review straight away, and a cancelled review
          posts nothing.
        </Note>
      </Section>

      <Section id="same-path" title="The same review as the App">
        <P>
          A local review is the same review the GitHub App runs, with the same checks on every
          finding and fix. It reads your local checkout instead of GitHub, and runs on your
          machine with your own key, not the organization&rsquo;s.
        </P>
      </Section>
    </DocsArticle>
  );
}
