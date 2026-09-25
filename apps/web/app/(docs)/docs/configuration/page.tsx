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
import { REPO_MODEL_CHOICES } from "@/lib/repo-settings";

export const metadata: Metadata = {
  title: "Configuration",
  description: "The model key, when each repository is reviewed, which model runs it, and fixes.",
};

const HEADINGS: Heading[] = [
  { id: "model-key", title: "Model key" },
  { id: "repositories", title: "Repository settings" },
  { id: "models", title: "Models" },
  { id: "fixes", title: "Fixes" },
  { id: "permissions", title: "What the App can access" },
];

const MODES = [
  ["Every pull request", "Default. Every pull request is reviewed when it is opened or reopened, and on every push."],
  ["On the ai-review label", "A pull request is reviewed when it gets the label, and on every push while it carries it."],
  ["Off", "Nothing is reviewed. The repository's past reviews stay on the dashboard."],
] as const;

const PERMISSIONS = [
  ["Contents", "Read and write", "Reads the files a review needs. Writes only to commit fixes, when you turn fixes on."],
  ["Pull requests", "Read and write", "Reads the pull request and posts the inline review comments."],
  ["Checks", "Read and write", "Publishes the AI PR Review check run."],
  ["Organization members", "Read", "Decides who can see the organization on the dashboard."],
  ["Metadata, email addresses", "Read", "Lists repositories and signs you in."],
] as const;

export default function ConfigurationPage() {
  return (
    <DocsArticle
      href="/docs/configuration"
      eyebrow="Using LintCat"
      title="Configuration"
      description="Everything is set on the dashboard. One model key per account, and a few settings per repository."
      headings={HEADINGS}
    >
      <Section id="model-key" title="Model key">
        <P>
          Reviews run on the account&rsquo;s own Anthropic or OpenAI API key. An owner of
          the account (on a personal account, you) sets it under <strong>Settings</strong> in
          the dashboard sidebar; other members don&rsquo;t see that page.
        </P>
        <P>
          The key is stored encrypted and only the review service ever reads it back. The
          dashboard shows the provider and the last four characters, nothing more. Replacing
          the key takes effect on the next review; removing it stops reviews until a new one is
          added.
        </P>
      </Section>

      <Section id="repositories" title="Repository settings">
        <P>
          Each repository has a <strong>Settings</strong> page, linked from the repository on
          the dashboard. Anyone who can see the repository can view it; account owners
          and people with admin or maintain access to the repository can change it.
        </P>
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">
              When a repository is reviewed, for each mode.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">When reviews run</TableHead>
                <TableHead scope="col">What happens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MODES.map(([mode, effect]) => (
                <TableRow key={mode}>
                  <TableCell className="whitespace-nowrap text-foreground">{mode}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{effect}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Note title="A push replaces a review in progress">
          If a pull request gets a new commit while it is being reviewed, the older review is
          dropped before it posts anything and the new commit is reviewed instead.
        </Note>
      </Section>

      <Section id="models" title="Models">
        <P>
          Each repository uses the provider default unless you pick a model on its settings
          page. The choices follow the provider of the account&rsquo;s key:
        </P>
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">The models offered for each provider.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Provider</TableHead>
                <TableHead scope="col">Models</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-foreground">Anthropic</TableCell>
                <TableCell className="font-mono whitespace-normal text-muted-foreground">
                  {REPO_MODEL_CHOICES.anthropic.join(", ")}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-foreground">OpenAI</TableCell>
                <TableCell className="font-mono whitespace-normal text-muted-foreground">
                  {REPO_MODEL_CHOICES.openai.join(", ")}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
        <Note title="Switched providers?">
          A model chosen for the old provider won&rsquo;t run on the new key. Reviews on that
          repository fail with a check run naming the model until you pick another one, or
          go back to the provider default.
        </Note>
      </Section>

      <Section id="fixes" title="Fixes">
        <P>
          With <strong>Commit verified fixes</strong> off, the default, a finding&rsquo;s fix
          arrives as a one-click suggested change on its review comment. Turn it on and
          LintCat commits the fixes to the pull request branch itself, in one commit.
        </P>
        <P>
          Fixes are never force-pushed. If someone pushed while the review was running, the
          commit is skipped and the fixes arrive as suggestions instead.
        </P>
      </Section>

      <Section id="permissions" title="What the App can access">
        <P>
          GitHub shows these when you install the App. It never approves or merges a pull
          request, and it only writes file contents when you turn fixes on.
        </P>
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">
              The GitHub permissions the App requests, and what each one is for.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Permission</TableHead>
                <TableHead scope="col">Access</TableHead>
                <TableHead scope="col">Used for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map(([permission, access, use]) => (
                <TableRow key={permission}>
                  <TableCell className="whitespace-nowrap text-foreground">{permission}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{access}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{use}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>
    </DocsArticle>
  );
}
