import { cn } from "@pr-review/design";
import Link from "next/link";
import type { ReactNode } from "react";

export type RowLinkProps = {
  href: string;
  children: ReactNode;
  "aria-label"?: string;
  className?: string;
};

// The ::after overlay resolves against the nearest positioned ancestor, so the row must be `relative`.
export function RowLink({ href, children, className, ...rest }: RowLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-xs font-medium text-ink no-underline underline-offset-2 outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:ring-2 focus-visible:ring-accent group-hover:underline",
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
