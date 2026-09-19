"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "#src/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-sm border font-mono text-label tracking-ui whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "border-accent bg-accent text-accent-ink font-semibold hover:bg-accent/90",
        outline:
          "border-rule bg-surface text-ink hover:border-accent",
        ghost:
          "border-transparent bg-transparent text-slate hover:bg-surface-2 hover:text-ink",
        subtle:
          "border-rule-soft bg-surface-2 text-ink hover:border-rule hover:bg-surface",
      },
      size: {
        sm: "h-7 px-2.5",
        md: "h-9 px-3.5",
        icon: "size-9 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
