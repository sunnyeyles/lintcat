import { cn } from "@pr-review/design";
import { Check as CheckIcon, X } from "@pr-review/design/icons";
import type { CSSProperties } from "react";

import type { CastRole } from "@/app/dev/run-trace/bot-look";
import type { BotStatus, BotView } from "@/app/dev/run-trace/bot-view";
import styles from "@/app/dev/run-trace/bots.module.css";
import { CONTEXT_LIMIT } from "@/app/dev/run-trace/trace-layout";

function fuelColor(fraction: number): string {
  if (fraction >= 0.85) return "var(--destructive)";
  if (fraction >= 0.6) return "var(--warning)";
  return "var(--success)";
}

export function BotPortrait({ bot, size }: { bot: BotView; size: "floor" | "card" }) {
  const px = size === "card" ? 240 : 120;
  return (
    <span aria-hidden="true" className="relative flex flex-col items-center gap-1">
      <CastFigure role={bot.cast} status={bot.status} px={px} />
      {bot.status === "running" ? <ToolPop tool={bot.activeTool} /> : null}
      {bot.peakContext !== undefined ? <FuelGauge tokens={bot.peakContext} width={px / 2} /> : null}
    </span>
  );
}

export function CastFigure({ role, status, px }: { role: CastRole; status?: BotStatus; px: number }) {
  const sheet = { "--sprite-sheet": `url(/factory-cast/${role}.png)`, "--sprite-size": `${px}px` } as CSSProperties;
  return (
    <span aria-hidden="true" className={cn(styles.figure, "relative block shrink-0")} style={{ width: px, height: px }}>
      <span
        className={cn(styles.sprite, status === "running" && styles.active, status === undefined && styles.waiting)}
        style={sheet}
      />
      {status === "done" ? (
        <span className="bg-success text-success-foreground absolute top-1 right-1 flex size-5 items-center justify-center rounded-full">
          <CheckIcon animate="none" className="size-3" />
        </span>
      ) : null}
      {status === "failed" ? (
        <span className="bg-destructive text-destructive-foreground absolute top-1 right-1 flex size-5 items-center justify-center rounded-full">
          <X animate="none" className="size-3" />
        </span>
      ) : null}
    </span>
  );
}

function ToolPop({ tool }: { tool?: string }) {
  const label = tool ? (tool.length > 7 ? `${tool.slice(0, 6)}…` : tool) : "···";
  return (
    <span className="absolute top-0 left-1/2 -translate-x-1/2">
      <span
        className={cn(
          styles.pop,
          "bg-primary text-primary-foreground border-card block rounded-full border-2 px-2 py-0.5 text-[11px] font-semibold",
        )}
      >
        {label}
      </span>
    </span>
  );
}

function FuelGauge({ tokens, width }: { tokens: number; width: number }) {
  const fraction = Math.min(1, tokens / CONTEXT_LIMIT);
  return (
    <span className="bg-muted block h-1.5 overflow-hidden rounded-full" style={{ width }}>
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(2, fraction * 100)}%`, backgroundColor: fuelColor(fraction) }}
      />
    </span>
  );
}
