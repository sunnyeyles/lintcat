import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SectionProps = {
  eyebrow: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ eyebrow, title, action, children, className }: SectionProps) {
  return (
    <section className={cn("mt-12", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-rule pb-2.5">
        <div className="flex items-baseline gap-3">
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="font-sans text-xl leading-tight font-medium text-ink">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
