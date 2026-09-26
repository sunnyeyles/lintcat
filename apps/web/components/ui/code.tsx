import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "rounded-sm border border-border bg-muted px-1 py-0.5 font-mono",
        className,
      )}
    >
      {children}
    </code>
  );
}
