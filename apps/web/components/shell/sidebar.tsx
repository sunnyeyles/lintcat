"use client";

import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@pr-review/design";
import { ChartLine, Coins, FolderGit2, LayoutDashboard, Menu } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";

import { organizationPath, withinOrganization } from "@/lib/paths";

// `href` is relative to the organization, e.g. "/repos" under `/o/<slug>`.
export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/repos", label: "Repositories", icon: FolderGit2 },
  { href: "/analytics", label: "Analytics", icon: ChartLine },
  { href: "/usage", label: "Usage", icon: Coins },
];

// On a subdomain the browser path has no `/o/<slug>` prefix, so compare without it.
function isActive(pathname: string, href: string): boolean {
  const page = withinOrganization(pathname);
  return href === "/" ? page === "/" : page.startsWith(href);
}

const LINK_CLASS =
  "focus-visible:ring-ring group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2";

function NavLinks({ slug, onNavigate }: { slug: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const root = organizationPath(slug);
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href === "/" ? root : root + href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              LINK_CLASS,
              active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export type SidebarProps = {
  slug: string;
  organizationName: string;
  className?: string;
};

export function Sidebar({ slug, organizationName, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "bg-sidebar hidden w-[13rem] shrink-0 border-r md:block",
        className,
      )}
    >
      <div className="sticky top-14 px-3 py-5">
        <p className="text-muted-foreground truncate border-b px-2.5 pb-2.5 text-xs tracking-wide uppercase">
          {organizationName}
        </p>
        <div className="pt-3">
          <NavLinks slug={slug} />
        </div>
      </div>
    </aside>
  );
}

export function SidebarDrawer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { slug } = useParams<{ slug?: string }>();
  if (slug === undefined) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Open navigation"
          className={cn("md:hidden", className)}
        >
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="max-w-[16rem]">
        <SheetHeader>
          <SheetTitle>Navigate</SheetTitle>
          <SheetDescription>pr-review-agents dashboard</SheetDescription>
        </SheetHeader>
        <div className="px-3 py-4">
          <NavLinks slug={slug} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
