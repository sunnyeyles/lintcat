"use client";

import { cn } from "@pr-review/design";
import { useEffect, useState } from "react";

import type { Heading } from "@/lib/docs";

export function Toc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState(headings[0]?.id);

  useEffect(() => {
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        const first = headings.find((heading) => seen.has(heading.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-72px 0px -60% 0px" },
    );
    for (const { id } of headings) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <aside className="hidden w-[13rem] shrink-0 xl:block">
      <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto">
        <p className="eyebrow border-b border-border pb-2">On this page</p>
        <nav aria-label="On this page" className="flex flex-col gap-1.5 pt-3">
          {headings.map(({ id, title }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
              className={cn(
                "text-caption leading-snug no-underline transition-colors",
                active === id ? "text-link" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {title}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}
