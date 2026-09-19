"use client";

import {
  cn,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@pr-review/design";
import { Bot, ChartLine, Coins, FolderGit2, LayoutDashboard, Menu } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/repos", label: "Repositories", icon: FolderGit2 },
  { href: "/analytics", label: "Analytics", icon: ChartLine },
  { href: "/usage", label: "Usage", icon: Coins },
  { href: "/settings/agents", label: "Agents", icon: Bot },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

const LINK_CLASS =
  "group flex items-center gap-2.5 rounded-sm border border-transparent px-2.5 py-1.5 font-mono text-label tracking-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              LINK_CLASS,
              active
                ? "border-rule-soft bg-accent-wash font-semibold text-accent"
                : "text-slate hover:border-rule-soft hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "hidden w-[13rem] shrink-0 border-r border-rule bg-paper md:block",
        className,
      )}
    >
      <div className="sticky top-14 px-3 py-5">
        <p className="eyebrow px-2.5 pb-2.5 border-b border-rule">Sections</p>
        <div className="pt-3">
          <NavLinks />
        </div>
      </div>
    </aside>
  );
}

export function SidebarDrawer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-sm border border-rule bg-surface text-slate transition-colors outline-none hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper md:hidden",
          className,
        )}
      >
        <Menu className="size-4" />
      </SheetTrigger>
      <SheetContent side="left" className="max-w-[16rem]">
        <SheetHeader>
          <SheetTitle>Navigate</SheetTitle>
          <SheetDescription>pr-review-agents dashboard</SheetDescription>
        </SheetHeader>
        <div className="px-3 py-4">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
        <SheetClose className="sr-only">Close navigation</SheetClose>
      </SheetContent>
    </Sheet>
  );
}
