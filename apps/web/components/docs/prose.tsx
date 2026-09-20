import { cn } from "@pr-review/design";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Heading } from "@/lib/docs";

function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-measure font-mono text-lede leading-relaxed text-slate">{children}</p>
  );
}

function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex max-w-measure flex-col gap-4", className)}>{children}</div>
  );
}

export function Section({ id, title, children }: Heading & { children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 flex flex-col gap-4 border-t border-rule pt-8">
      <h2 className="font-display text-h2 font-medium tracking-display text-ink">
        <Link href={`#${id}`} className="text-ink no-underline hover:text-accent">
          {title}
        </Link>
      </h2>
      {children}
    </section>
  );
}

export function Subheading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display text-h3 font-medium tracking-display text-ink">{children}</h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-measure font-mono text-body leading-relaxed text-slate">{children}</p>
  );
}

export function Bullets({ children }: { children: ReactNode }) {
  return (
    <ul className="flex max-w-measure list-none flex-col gap-2.5 font-mono text-body leading-relaxed text-slate">
      {children}
    </ul>
  );
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:size-1 before:bg-accent">
      {children}
    </li>
  );
}

export function Code({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure className="overflow-hidden rounded-sm border border-rule bg-surface">
      {caption ? (
        <figcaption className="eyebrow border-b border-rule bg-surface-2 px-3 py-2">
          {caption}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto px-3 py-3 font-mono text-caption leading-relaxed text-ink">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="max-w-measure border-l-2 border-accent bg-accent-wash px-4 py-3">
      <p className="eyebrow text-accent">{title}</p>
      <p className="mt-1.5 font-mono text-body leading-relaxed text-slate">{children}</p>
    </aside>
  );
}
