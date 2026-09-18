import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

export type PageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-rule pb-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-[18rem]">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1.5 font-display text-h1 font-medium tracking-display text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-measure font-mono text-body leading-relaxed text-slate">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
