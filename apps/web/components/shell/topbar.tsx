import Link from "next/link";

import { SidebarDrawer } from "@/components/shell/sidebar";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function DemoDataBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[2px] border border-warn/60 bg-warn/10 px-1.5 py-[0.2rem] font-mono text-[0.62rem] leading-none font-semibold tracking-[0.14em] text-warn uppercase outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          className,
        )}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-warn" />
        Demo data
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Every figure here is generated fixture data. No ingestion path from real
        reviews exists yet.
      </TooltipContent>
    </Tooltip>
  );
}

export function Topbar({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
        <SidebarDrawer />
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <span aria-hidden className="size-2 shrink-0 bg-accent" />
          <span className="truncate font-mono text-[0.8rem] font-semibold tracking-[0.02em] text-ink">
            pr-review-agents
          </span>
          <span className="hidden font-mono text-[0.68rem] text-slate-dim sm:inline">
            / dashboard
          </span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <DemoDataBadge />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
