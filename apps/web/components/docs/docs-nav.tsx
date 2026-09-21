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
import { BookText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { DOCS_NAV, isDocsPageActive } from "@/lib/docs";

const LINK_CLASS =
  "block rounded-sm border border-transparent px-2.5 py-1.5 font-mono text-label tracking-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="flex flex-col gap-5">
      {DOCS_NAV.map((section) => (
        <div key={section.title} className="flex flex-col gap-0.5">
          <p className="eyebrow px-2.5 pb-1.5">{section.title}</p>
          {section.pages.map((page) => {
            const active = isDocsPageActive(pathname, page.href);
            return (
              <Link
                key={page.href}
                href={page.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  LINK_CLASS,
                  active
                    ? "border-border-subtle bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:border-border-subtle hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {page.title}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function DocsSidebar({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "hidden w-[15rem] shrink-0 border-r border-border bg-background md:block",
        className,
      )}
    >
      <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto px-3 py-6">
        <NavLinks />
      </div>
    </aside>
  );
}

export function DocsNavDrawer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={cn(
          "inline-flex items-center gap-2 rounded-sm border border-border bg-card px-2.5 py-1.5 font-mono text-label tracking-ui text-muted-foreground transition-colors outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden",
          className,
        )}
      >
        <BookText className="size-3.5" />
        Documentation
      </SheetTrigger>
      <SheetContent side="left" className="max-w-[17rem]">
        <SheetHeader>
          <SheetTitle>Documentation</SheetTitle>
          <SheetDescription>pr-review-agents</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-3 py-4">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
        <SheetClose className="sr-only">Close documentation menu</SheetClose>
      </SheetContent>
    </Sheet>
  );
}
