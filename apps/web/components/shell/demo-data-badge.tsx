"use client";

import {
  ChipDot,
  chipVariants,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@pr-review/design";
import { usePathname } from "next/navigation";

import { withinOrganization } from "@/lib/paths";

// These pages still read the generated fixture; the rest read the database.
export const DEMO_PATHS = ["/analytics", "/usage", "/settings"];

export function DemoDataBadge({ className }: { className?: string }) {
  const pathname = usePathname();
  const page = withinOrganization(pathname);
  if (!DEMO_PATHS.some((path) => page.startsWith(path))) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={cn(
          chipVariants({ tone: "warn", caps: true }),
          "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          className,
        )}
      >
        <ChipDot />
        Demo data
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Every figure on this page is generated fixture data. Recorded reviews are
        not wired to it yet.
      </TooltipContent>
    </Tooltip>
  );
}
