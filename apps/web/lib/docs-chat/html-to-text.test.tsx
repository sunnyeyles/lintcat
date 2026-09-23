import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pr-review/design";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Bullet, Bullets, Code, DocsArticle, Note, P, Section } from "@/components/docs";
import { htmlToCorpusText } from "@/lib/docs-chat/html-to-text";

function text(children: ReactNode): string {
  return htmlToCorpusText(
    renderToStaticMarkup(
      <DocsArticle
        href="/docs/quickstart"
        eyebrow="Start here"
        title="Page title"
        description="The lede."
        headings={[{ id: "one", title: "One" }]}
      >
        {children}
      </DocsArticle>,
    ),
  );
}

describe("htmlToCorpusText", () => {
  it("keeps the header and drops the pagination and table of contents", () => {
    const out = text(<P>Body.</P>);
    expect(out).toBe("Start here\n\n# Page title\n\nThe lede.\n\nBody.");
  });

  it("turns a section heading into a markdown heading carrying its anchor", () => {
    expect(text(<Section id="one" title="One"><P>x</P></Section>)).toContain("## One {#one}\n\nx");
  });

  it("keeps inline code, bold, and links to pages and sections", () => {
    const out = text(
      <P>
        Add the <code>ai-review</code> label under <strong>Settings</strong>. See{" "}
        <a href="/docs/configuration#models">Models</a> or <a href="#one">above</a>.
      </P>,
    );
    expect(out).toContain(
      "Add the `ai-review` label under **Settings**. See [Models](/docs/configuration#models) or above.",
    );
  });

  it("lists bullets and table rows on their own lines", () => {
    const out = text(
      <>
        <Bullets>
          <Bullet>first</Bullet>
          <Bullet>second</Bullet>
        </Bullets>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>What it does</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>review</TableCell>
                <TableCell>Reviews &amp; posts</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </>,
    );
    expect(out).toContain("- first\n- second");
    expect(out).toContain("| Tool | What it does |\n| review | Reviews & posts |");
  });

  it("puts a note's title inline and keeps a code block verbatim", () => {
    const out = text(
      <>
        <Note title="Careful">It's advisory.</Note>
        <Code caption="Terminal">{"a  <b>\n  c && d"}</Code>
      </>,
    );
    expect(out).toContain("**Note: Careful** It's advisory.");
    expect(out).toContain("Terminal:\n\n```\na  <b>\n  c && d\n```");
  });
});
