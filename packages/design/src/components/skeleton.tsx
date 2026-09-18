import type { ComponentProps } from "react";

import { cn } from "#src/cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-xs bg-surface-2", className)}
      {...props}
    />
  );
}
