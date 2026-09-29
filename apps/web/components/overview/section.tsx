import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

import { SectionHeading } from "@/components/ui";

export type SectionProps = {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={cn("mt-8", className)}>
      <SectionHeading title={title} action={action} />
      <div className="mt-6">{children}</div>
    </section>
  );
}
