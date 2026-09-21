import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

export type PageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  // A record page (one review) gets GitHub's 20px PR-title size.
  size?: "landing" | "record";
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "landing",
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b pb-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-[18rem]">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          {eyebrow}
        </p>
        <h1
          className={cn(
            "mt-1.5 font-semibold",
            size === "record" ? "text-xl leading-tight" : "text-h1 tracking-tight",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground mt-2 max-w-prose text-sm leading-relaxed">
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
