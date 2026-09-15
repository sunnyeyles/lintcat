"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "font-mono text-[0.68rem] tracking-[0.12em] text-slate-dim uppercase peer-disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}
