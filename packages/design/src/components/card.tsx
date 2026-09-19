import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "#src/cn";

export const cardVariants = cva("rounded-sm border border-rule bg-surface shadow-card", {
  variants: {
    padding: {
      none: "",
      table: "px-4 py-3 sm:px-5",
    },
  },
  defaultVariants: { padding: "none" },
});

export type CardProps = ComponentProps<"div"> & VariantProps<typeof cardVariants>;

export function Card({ className, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ padding }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-rule-soft px-4 py-3 sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn("font-display text-h3 leading-tight font-medium text-ink", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("mt-1 font-mono text-label leading-relaxed text-slate", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-rule-soft px-4 py-3 sm:px-5",
        className,
      )}
      {...props}
    />
  );
}
