import Link from "next/link";
import type { ReactNode } from "react";

import type { Heading } from "@/lib/docs";
import type { FaqItem } from "@/lib/faq";

export function Section({ id, title, children }: Heading & { children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 flex flex-col gap-4 border-t border-border pt-8">
      <h2 className="font-display text-h2 font-semibold tracking-display text-foreground">
        <Link href={`#${id}`} className="text-foreground no-underline hover:text-link">
          {title}
        </Link>
      </h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-measure text-body text-muted-foreground">{children}</p>
  );
}

export function Bullets({ children }: { children: ReactNode }) {
  return (
    <ul className="flex max-w-measure list-none flex-col gap-2.5 text-body text-muted-foreground">
      {children}
    </ul>
  );
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:size-1 before:bg-primary">
      {children}
    </li>
  );
}

export function Code({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure className="overflow-hidden rounded-sm border border-border bg-card">
      {caption ? (
        <figcaption className="eyebrow border-b border-border bg-surface-2 px-3 py-2">
          {caption}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto px-3 py-3 font-mono text-label leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="max-w-measure border-l-2 border-primary bg-primary/10 px-4 py-3">
      <p className="eyebrow text-link">{title}</p>
      <p className="mt-1.5 text-body text-muted-foreground">{children}</p>
    </aside>
  );
}

export const FAQ_HEADING: Heading = { id: "faq", title: "Frequently asked questions" };

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <Section {...FAQ_HEADING}>
      <div className="flex max-w-measure flex-col gap-5">
        {items.map(({ question, answer }) => (
          <div key={question} className="flex flex-col gap-1.5">
            <h3 className="text-body font-semibold text-foreground">{question}</h3>
            <p className="text-body text-muted-foreground">{answer}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
