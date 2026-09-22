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
import { ChartLine, Coins, FolderGit2, LayoutDashboard, Menu, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";

import { organizationPath, withinOrganization } from "@/lib/paths";

// `href` is relative to the organization, e.g. "/repos" under `/o/<slug>`.
type NavItem = { href: string; label: string; icon: LucideIcon; ownerOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/repos", label: "Repositories", icon: FolderGit2 },
  { href: "/analytics", label: "Analytics", icon: ChartLine },
  { href: "/usage", label: "Usage", icon: Coins },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

// On a subdomain the browser path has no `/o/<slug>` prefix, so compare without it.
function isActive(pathname: string, href: string): boolean {
  const page = withinOrganization(pathname);
  return href === "/" ? page === "/" : page.startsWith(href);
}

const LINK_CLASS =
  "focus-visible:ring-ring group flex h-control items-center gap-2.5 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-2";

function NavLinks({
  slug,
  isOwner,
  onNavigate,
}: {
  slug: string;
  isOwner: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const root = organizationPath(slug);
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV_ITEMS.filter((item) => isOwner || !item.ownerOnly).map(({ href, label, icon: Icon }) => {
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
            <Icon className={cn("size-4 shrink-0", active && "text-attention")} />
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
  isOwner?: boolean;
  className?: string;
};

export function Sidebar({ slug, organizationName, isOwner = false, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "bg-sidebar hidden w-64 shrink-0 border-r md:block",
        className,
      )}
    >
      <div className="sticky top-16 px-3 py-5">
        <p className="text-muted-foreground truncate border-b px-2.5 pb-2.5 text-xs tracking-wide uppercase">
          {organizationName}
        </p>
        <div className="pt-3">
          <NavLinks slug={slug} isOwner={isOwner} />
        </div>
      </div>
    </aside>
  );
}

export function SidebarDrawer({ isOwner = false, className }: { isOwner?: boolean; className?: string }) {
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
          <NavLinks slug={slug} isOwner={isOwner} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
