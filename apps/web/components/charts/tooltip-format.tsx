"use client";

import type { ComponentProps } from "react";

import type { ChartTooltipContent } from "@pr-review/design/chart";

type Formatter = NonNullable<ComponentProps<typeof ChartTooltipContent>["formatter"]>;

// ChartTooltipContent's formatter replaces the whole row, so the indicator is redrawn here.
export function formatWith(format: (value: number) => string): Formatter {
  return (value, name, item) => (
    <>
      <div
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: item?.color }}
      />
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{String(name)}</span>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {format(Number(value))}
        </span>
      </div>
    </>
  );
}
