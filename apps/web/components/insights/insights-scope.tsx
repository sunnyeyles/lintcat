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

// The range lives in the URL, so each tab link carries it; the frame dims while a new one streams.
export function InsightsScope({ tabs, children }: InsightsScopeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const param = useSearchParams().get("range");
  const [pending, startTransition] = useTransition();
  const range = parseRange(param);
  const query = rangeQuery(param);
  const active = tabs.find((tab) => isActiveTab(pathname, tab.href));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b">
        <Tabs value={active?.href ?? ""} activationMode="manual">
          <TabsList variant="line" aria-label="Insights" className="border-b-0">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.href} value={tab.href} asChild>
                <Link
                  href={tab.href + query}
                  aria-current={tab === active ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
