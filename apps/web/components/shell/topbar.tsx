import {
  ChipDot,
  chipVariants,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@pr-review/design";
import Link from "next/link";

import { SidebarDrawer } from "@/components/shell/sidebar";
import { ThemeToggle } from "@/components/shell/theme-toggle";

function DemoDataBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={cn(
          chipVariants({ tone: "warn", caps: true }),
          "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          className,
        )}
      >
        <ChipDot />
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
          className="flex min-w-0 items-center gap-2 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <span aria-hidden className="size-2 shrink-0 bg-brand" />
          <span className="truncate font-mono text-body font-semibold tracking-ui text-ink">
            pr-review-agents
          </span>
          <span className="hidden font-mono text-caption text-slate sm:inline">
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
