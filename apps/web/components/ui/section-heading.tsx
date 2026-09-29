import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

export type SectionHeadingProps = {
  title: ReactNode;
  id?: string;
  action?: ReactNode;
  className?: string;
};

export function SectionHeading({ title, id, action, className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border pb-2.5",
        className,
      )}
    >
      <h2 id={id} className="scroll-mt-4 font-sans text-h2 font-semibold text-foreground">
        {title}
      </h2>
      {action}
    </div>
  );
}
