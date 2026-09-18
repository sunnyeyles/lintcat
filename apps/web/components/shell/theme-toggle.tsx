"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ORDER = ["system", "light", "dark"] as const;

const META = {
  system: { Icon: Monitor, label: "System theme" },
  light: { Icon: Sun, label: "Light theme" },
  dark: { Icon: Moon, label: "Dark theme" },
} as const;

const TRIGGER_CLASS =
  "inline-flex size-8 items-center justify-center rounded-[3px] border border-rule bg-surface text-slate transition-colors outline-none hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span
        aria-hidden
        className={cn(TRIGGER_CLASS, "pointer-events-none", className)}
      />
    );
  }

  const current = ORDER.includes(theme as (typeof ORDER)[number])
    ? (theme as (typeof ORDER)[number])
    : "system";
  const { Icon, label } = META[current];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={`${label}. Switch to ${META[next].label.toLowerCase()}`}
        onClick={() => setTheme(next)}
        className={cn(TRIGGER_CLASS, className)}
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{label} — click for {META[next].label.toLowerCase()}</TooltipContent>
    </Tooltip>
  );
}
