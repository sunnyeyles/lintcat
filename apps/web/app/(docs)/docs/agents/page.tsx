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

import { Bullet, Bullets, Code, DocsArticle, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Agents",
  description: "The general agent, the five specialists, and how a repository picks.",
};

const HEADINGS: Heading[] = [
  { id: "shipped", title: "What ships" },
  { id: "opting-in", title: "Opting in" },
  { id: "rules", title: "What follows from the set" },
];

const AGENTS = [
  ["general", "The default: all of the below in one pass"],
  ["security", "Auth, cross-tenant access, injection, secret leakage, privilege"],
  ["correctness", "Logic errors, wrong bounds, unhandled null, broken error handling"],
  ["performance", "N+1 queries, unbounded reads, quadratic scans, blocking I/O"],
  ["test-coverage", "Branches this change adds or changes and leaves untested"],
  ["docs-drift", "Documentation this change made wrong"],
] as const;

export default function AgentsPage() {
  return (
    <DocsArticle
      href="/docs/agents"
      eyebrow="How it works"
      title="Agents"
      description="Configuration selects agents; it does not define them. The prompts ship with the action, so a pull request cannot rewrite the reviewers."
      headings={HEADINGS}
    >
      <Section id="shipped" title="What ships">
        <P>
          With no configuration file, the <code>general</code> agent reviews every pull request
          on its own and its findings carry the <code>general</code> category. Five opt-in
          specialists ship alongside it.
        </P>
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">
              The agents that ship, and what each reviews for.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Reviews for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AGENTS.map(([name, reviews]) => (
                <TableRow key={name}>
                  <TableCell className="font-mono text-foreground">{name}</TableCell>
                  <TableCell className="text-muted-foreground">{reviews}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section id="opting-in" title="Opting in">
        <P>
          Name the agents you want in <code>.github/pr-review-agents.yml</code>, or wherever{" "}
          <code>agent-config</code> points. Once the file exists it replaces the default:{" "}
          <code>general</code> runs only if it is listed. Adding an agent is a new name;
          removing one is deleting its line.
        </P>
        <Code caption=".github/pr-review-agents.yml">{`agents:
  - security
  - correctness
  - performance
  - test-coverage
  - docs-drift`}</Code>
        <P>
          The <code>agents</code> Action input narrows that set per run — <code>all</code>, or
          a comma-separated subset of their names. Naming a subset also overrides any path
          filters.
        </P>
      </Section>

      <Section id="rules" title="What follows from the set">
        <P>
          Everything downstream follows from the configured agents: the prompt each one is
          given, the categories the synthesiser is told about, the categories validation
          accepts, and the labels findings are rendered under.
        </P>
        <Bullets>
          <Bullet>
            An agent&rsquo;s name is also the finding category it owns, and the only category
            its findings may carry — findings in any other are discarded.
          </Bullet>
          <Bullet>Order is significant: it is the order findings reach the synthesiser.</Bullet>
        </Bullets>
      </Section>

    </DocsArticle>
  );
}
