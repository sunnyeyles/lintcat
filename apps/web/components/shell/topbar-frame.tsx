import { cn } from "@pr-review/design";
import Link from "next/link";
import type { ReactNode } from "react";

import { ColorModeToggle } from "@/components/shell/color-mode-toggle";
import { Wordmark } from "@/components/shell/logo-mark";

/** The topbar's chrome, with no request-bound data, so a static page can render it. */
export function TopbarFrame({
  className,
  docsHref,
  left,
  right,
}: {
  className?: string;
  docsHref: string;
  left?: ReactNode;
  right: ReactNode;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
        {left}
        <Link
          href={docsHref}
          className="flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="ml-4 hidden items-center gap-1 sm:flex">
          <Link
            href={docsHref}
            className="rounded-sm px-2 py-1 text-xs text-muted-foreground no-underline transition-colors hover:text-foreground"
          >
            Docs
          </Link>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {right}
          <ColorModeToggle />
        </div>
      </div>
    </header>
  );
}
