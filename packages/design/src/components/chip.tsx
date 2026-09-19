import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "#src/cn";

// Tone sets --chip so every variant can colour itself from it.
export const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-xs border px-1.5 py-[0.2rem] font-mono text-caption leading-none whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        solid: "border-(--chip) bg-(--chip) font-bold text-paper",
        tint: "border-(--chip)/40 bg-(--chip)/10 font-semibold text-(--chip)",
        outline: "border-rule bg-transparent text-(--chip)",
        soft: "border-rule-soft bg-surface-2 text-slate",
      },
      tone: {
        neutral: "[--chip:var(--slate)]",
        accent: "[--chip:var(--accent)]",
        ok: "[--chip:var(--ok)]",
        warn: "[--chip:var(--warn)]",
        stop: "[--chip:var(--stop)]",
        low: "[--chip:var(--sev-low)]",
        medium: "[--chip:var(--sev-medium)]",
        high: "[--chip:var(--sev-high)]",
        "agent-docs": "[--chip:var(--agent-docs)]",
        "agent-security": "[--chip:var(--agent-security)]",
        "agent-correctness": "[--chip:var(--agent-correctness)]",
        "agent-performance": "[--chip:var(--agent-performance)]",
        "agent-tests": "[--chip:var(--agent-tests)]",
      },
      shape: {
        square: "",
        pill: "rounded-full",
      },
      caps: {
        true: "tracking-caps uppercase",
        false: "",
      },
    },
    defaultVariants: { variant: "tint", tone: "neutral", shape: "square", caps: false },
  },
);

export type ChipProps = ComponentProps<"span"> & VariantProps<typeof chipVariants>;

export function Chip({ className, variant, tone, shape, caps, ...props }: ChipProps) {
  return <span className={cn(chipVariants({ variant, tone, shape, caps }), className)} {...props} />;
}

export function ChipDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-current", className)} />;
}
