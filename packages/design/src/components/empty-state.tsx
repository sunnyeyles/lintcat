import type { ReactNode } from "react";

import { cn } from "#src/cn";

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-rule px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-9 items-center justify-center rounded-sm border border-rule-soft bg-surface-2 text-slate [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <p className="font-display text-h3 leading-tight font-medium text-ink">{title}</p>
      {description ? (
        <p className="max-w-[44ch] font-mono text-label leading-relaxed text-slate">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
