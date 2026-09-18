import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

export type SectionProps = {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={cn("mt-12", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-rule pb-2.5">
        <h2 className="font-display text-h3 leading-tight font-medium text-ink">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
