import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
        "rounded-[2px] font-medium text-ink no-underline outline-none after:absolute after:inset-0 after:content-[''] hover:text-accent focus-visible:ring-2 focus-visible:ring-accent group-hover:text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
