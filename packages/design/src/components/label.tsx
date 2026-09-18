"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";

import { cn } from "#src/cn";

export function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "font-mono text-caption tracking-caps text-slate uppercase peer-disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}
