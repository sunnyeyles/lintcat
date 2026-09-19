"use client";

import { cn, Tabs, TabsList, TabsTrigger } from "@pr-review/design";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useTransition } from "react";

import type { Range } from "@pr-review/db/dashboard";

import { RANGE_LABEL, RANGES } from "./range";

export type RangeScopeProps = {
  range: Range;
  label?: string;
  children: ReactNode;
};

// One filter row above everything it scopes; the frame holds while the server refetches.
export function RangeScope({ range, label = "Range", children }: RangeScopeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="eyebrow">{label}</span>
        <Tabs
          value={range}
          onValueChange={(next) =>
            startTransition(() => router.replace(`${pathname}?range=${next}`, { scroll: false }))
          }
        >
          <TabsList aria-label="Date range" className="border-b-0 gap-3">
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
      <div
        className={cn(
          "flex min-w-0 flex-col gap-5 transition-opacity duration-150",
          pending && "opacity-60",
        )}
      >
        {children}
      </div>
    </div>
  );
}
