import { cn } from "@pr-review/design";
import type { ComponentProps } from "react";

export function Code({ className, ...props }: ComponentProps<"code">) {
  return (
    <code
      className={cn("rounded-sm border border-border bg-muted px-1 py-0.5 font-mono", className)}
      {...props}
    />
  );
}
