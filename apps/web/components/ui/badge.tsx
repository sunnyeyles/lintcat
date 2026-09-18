import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[2px] border font-mono text-[0.64rem] leading-none tracking-[0.08em] uppercase whitespace-nowrap px-1.5 py-[0.2rem] [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-accent bg-accent text-accent-ink font-semibold",
        outline: "border-current bg-transparent font-semibold",
        soft: "border-rule-soft bg-surface-2 text-slate",
      },
      tone: {
        neutral: "",
        accent: "text-accent",
        ok: "text-ok",
        warn: "text-warn",
        stop: "text-stop",
        low: "text-sev-low",
        medium: "text-sev-medium",
        high: "text-sev-high",
      },
    },
    defaultVariants: { variant: "default", tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, tone, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, tone }), className)} {...props} />
  );
}
