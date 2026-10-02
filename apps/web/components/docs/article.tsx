import { cn } from "@pr-review/design";
import { ArrowLeft, ArrowRight } from "@pr-review/design/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { Faq, FAQ_HEADING } from "@/components/docs/prose";
import { Toc } from "@/components/docs/toc";
import { JsonLd } from "@/components/json-ld";
import { DOCS_PAGES, docsNeighbours, type DocsPage, type Heading } from "@/lib/docs";
import type { FaqItem } from "@/lib/faq";
import { faqPage, techArticle } from "@/lib/structured-data";

function Neighbour({ page, direction }: { page: DocsPage; direction: "previous" | "next" }) {
  const next = direction === "next";
  return (
    <Link
      href={page.href}
      className={cn(
        "group flex flex-1 flex-col gap-1 rounded-sm border border-border bg-card px-4 py-3 no-underline transition-colors hover:border-primary",
        next ? "items-end text-right" : "items-start",
      )}
    >
      <span className="eyebrow flex items-center gap-1.5">
        {next ? null : <ArrowLeft className="size-3" />}
        {next ? "Next" : "Previous"}
        {next ? <ArrowRight className="size-3" /> : null}
      </span>
      <span className="text-label text-foreground group-hover:text-link">{page.title}</span>
    </Link>
  );
}

export type DocsArticleProps = {
  href: string;
  eyebrow: string;
  title: string;
  description: ReactNode;
  headings: Heading[];
  faq?: FaqItem[];
  children: ReactNode;
};

export function DocsArticle({
  href,
  eyebrow,
  title,
  description,
  headings,
  faq,
  children,
}: DocsArticleProps) {
  const { previous, next } = docsNeighbours(href);
  const summary = DOCS_PAGES.find((page) => page.href === href)?.summary ?? "";
  const structured = [techArticle(href, title, summary), ...(faq ? [faqPage(faq)] : [])];
  return (
    <div className="mx-auto flex w-full max-w-[72rem] gap-10 px-6 py-8 sm:px-8">
      <JsonLd nodes={structured} />
      <article className="flex min-w-0 flex-1 flex-col gap-8 [&>section:first-of-type]:border-t-0 [&>section:first-of-type]:pt-0">
        <header className="flex flex-col gap-3 border-b border-border pb-6">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="font-display text-h1 font-semibold tracking-display text-foreground">{title}</h1>
          <p className="max-w-measure text-lede text-muted-foreground">
            {description}
          </p>
        </header>
        {children}
        {faq ? <Faq items={faq} /> : null}
        {previous || next ? (
          <nav
            aria-label="Pagination"
            className="flex flex-wrap gap-3 border-t border-border pt-6"
          >
            {previous ? <Neighbour page={previous} direction="previous" /> : null}
            {next ? <Neighbour page={next} direction="next" /> : null}
          </nav>
        ) : null}
      </article>
      <Toc headings={faq ? [...headings, FAQ_HEADING] : headings} />
    </div>
  );
}
