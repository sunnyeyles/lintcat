import { Button, cn } from "@pr-review/design";
import { headers } from "next/headers";
import Link from "next/link";

import { SidebarDrawer } from "@/components/shell/sidebar";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { DOCS_HOME } from "@/lib/docs";
import { appDomain } from "@/lib/host";
import { apexUrl, DASHBOARD_PATH } from "@/lib/paths";

export async function Topbar({ className }: { className?: string }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const domain = appDomain();
  const docs = apexUrl(DOCS_HOME, host, protocol, domain);
  const dashboard = apexUrl(DASHBOARD_PATH, host, protocol, domain);

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
          href={docs}
          className="flex min-w-0 items-center gap-2 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <span aria-hidden className="size-2 shrink-0 bg-brand" />
          <span className="truncate font-mono text-body font-semibold tracking-ui text-ink">
            pr-review-agents
          </span>
        </Link>
        <nav aria-label="Site" className="ml-4 hidden items-center gap-1 sm:flex">
          <Link
            href={docs}
            className="rounded-sm px-2 py-1 font-mono text-label tracking-ui text-slate no-underline transition-colors hover:text-ink"
          >
            Docs
          </Link>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={dashboard}>Dashboard</Link>
          </Button>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
