import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
        <h1 className="mt-1.5 font-sans text-[clamp(1.6rem,1.3rem+1.1vw,2.2rem)] font-medium tracking-[-0.015em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-[62ch] font-mono text-[0.74rem] leading-relaxed text-slate">
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
