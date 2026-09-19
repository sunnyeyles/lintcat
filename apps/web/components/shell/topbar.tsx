import { cn } from "@pr-review/design";
import Link from "next/link";

import { SidebarDrawer } from "@/components/shell/sidebar";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";

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
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
