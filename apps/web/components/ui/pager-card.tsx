import { cn } from "@pr-review/design";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type PagerCardProps = { href: string; direction: "back" | "forward"; label: string; children: ReactNode };

export function PagerCard({ href, direction, label, children }: PagerCardProps) {
  const forward = direction === "forward";
  const Icon = forward ? ArrowRight : ArrowLeft;
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-w-0 flex-1 basis-56 flex-col gap-1 rounded-sm border border-border bg-card px-4 py-3 no-underline transition-colors outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        forward ? "items-end text-right" : "items-start",
      )}
    >
      <span className={cn("eyebrow flex items-center gap-1.5", forward && "flex-row-reverse")}>
        <Icon className="size-3 group-hover:text-link" />
        {label}
      </span>
      <span className="block max-w-full truncate text-foreground group-hover:text-link">
        {children}
      </span>
    </Link>
  );
}
