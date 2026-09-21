"use client";

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@pr-review/design";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type ColorMode = "light" | "dark" | "auto";

export const COLOR_MODE_KEY = "color-mode";
const ORDER: ColorMode[] = ["light", "dark", "auto"];
const LABEL: Record<ColorMode, string> = { light: "Light", dark: "Dark", auto: "System" };

function readMode(): ColorMode {
  const current = document.documentElement.dataset.colorMode;
  return current === "light" || current === "dark" ? current : "auto";
}

export function ColorModeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ColorMode>("auto");
  useEffect(() => setMode(readMode()), []);

  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] ?? "auto";
  const apply = () => {
    document.documentElement.dataset.colorMode = next;
    try {
      if (next === "auto") localStorage.removeItem(COLOR_MODE_KEY);
      else localStorage.setItem(COLOR_MODE_KEY, next);
    } catch {}
    setMode(next);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={className}
          onClick={apply}
          aria-label={`Colour mode: ${LABEL[mode]}. Switch to ${LABEL[next]}`}
        >
          {mode === "light" ? <Sun /> : mode === "dark" ? <Moon /> : <Monitor />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{LABEL[mode]} · click for {LABEL[next]}</TooltipContent>
    </Tooltip>
  );
}
