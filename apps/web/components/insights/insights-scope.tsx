"use client";

import { cn, Tabs, TabsList, TabsTrigger } from "@pr-review/design";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useTransition } from "react";

import { parseRange, RANGE_LABEL, RANGES, rangeQuery } from "@/components/charts/range";

import { type InsightsTab, isActiveTab } from "./paths";

export type InsightsScopeProps = {
  tabs: readonly InsightsTab[];
  children: ReactNode;
};

const TAB_LINK =
  "focus-visible:ring-ring -mb-px inline-flex h-11 items-center border-b-2 px-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2";

// The range lives in the URL, so each tab link carries it; the frame dims while a new one streams.
export function InsightsScope({ tabs, children }: InsightsScopeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const param = useSearchParams().get("range");
  const [pending, startTransition] = useTransition();
  const range = parseRange(param);
  const query = rangeQuery(param);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b">
        <nav aria-label="Insights" className="flex gap-5">
          {tabs.map((tab) => {
            const active = isActiveTab(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href + query}
                aria-current={active ? "page" : undefined}
                className={cn(
                  TAB_LINK,
                  active
                    ? "border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 pb-2">
          <Tabs
            value={range}
            onValueChange={(next) =>
              startTransition(() => router.replace(`${pathname}?range=${next}`, { scroll: false }))
            }
          >
            <TabsList aria-label="Date range">
              {RANGES.map((option) => (
                <TabsTrigger key={option} value={option}>
                  {RANGE_LABEL[option]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span aria-live="polite" className="sr-only">
            {pending ? "Loading new range" : ""}
          </span>
        </div>
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-6 transition-opacity duration-150",
          pending && "opacity-60",
        )}
      >
        {children}
      </div>
    </div>
  );
}
