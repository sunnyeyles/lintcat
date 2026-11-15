"use client";

import { cn, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@pr-review/design";
import { ArrowRight } from "@pr-review/design/icons";

import { BotFigure } from "@/app/dev/run-trace/bot-figure";
import type { Floor, TreeBox } from "@/app/dev/run-trace/bot-layout";
import { botLook } from "@/app/dev/run-trace/bot-look";
import { botLabel, botStats, type BotView } from "@/app/dev/run-trace/bot-view";
import styles from "@/app/dev/run-trace/bots.module.css";

type FloorProps = {
  prefix: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
};

export function BotFloor({ floor, ...props }: FloorProps & { floor: Floor }) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="bg-surface-2 overflow-x-auto rounded-xl border p-6">
        {floor.kind === "tree" ? (
          <div className="flex min-w-fit justify-center">
            <TreeNode box={floor.root} {...props} />
          </div>
        ) : (
          <div className="flex min-w-fit items-stretch justify-center gap-2">
            {floor.lanes.map((lane, i) => (
              <div key={lane.stage ?? `lane-${i}`} className="flex items-center gap-2">
                {i > 0 ? (
                  <ArrowRight aria-hidden animate="none" className="text-muted-foreground size-5 shrink-0" />
                ) : null}
                <section className={cn("flex h-full flex-col gap-2 rounded-lg p-3", lane.stage && "bg-card border")}>
                  {lane.stage ? (
                    <h3 className="text-muted-foreground text-center text-xs font-semibold tracking-wide uppercase">
                      {lane.stage}
                    </h3>
                  ) : null}
                  <div className="flex flex-1 items-start justify-center gap-3">
                    {lane.bots.map((bot) => (
                      <BotButton key={bot.id} bot={bot} {...props} />
                    ))}
                  </div>
                </section>
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function TreeNode({ box, ...props }: FloorProps & { box: TreeBox }) {
  const { color } = botLook(box.bot.role, props.prefix);
  return (
    <div className="flex flex-col items-center">
      <BotButton bot={box.bot} {...props} />
      {box.waves.length > 0 ? (
        <div className="flex flex-col items-center">
          <span className="h-4 w-0.5" style={{ backgroundColor: color }} />
          <div
            className="flex items-center gap-2 rounded-2xl border-2 border-dashed p-3"
            style={{ borderColor: color }}
          >
            {box.waves.map((wave, i) => (
              <div key={wave[0].bot.id} className="flex items-center gap-2">
                {i > 0 ? (
                  <ArrowRight aria-hidden animate="none" className="text-muted-foreground size-5 shrink-0" />
                ) : null}
                <div
                  className={cn(
                    "flex items-start justify-center gap-1",
                    wave.length > 1 && "bg-card/60 rounded-xl border p-1",
                  )}
                >
                  {wave.map((child) => (
                    <TreeNode key={child.bot.id} box={child} {...props} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BotButton({ bot, prefix, selectedId, onOpen }: FloorProps & { bot: BotView }) {
  const look = botLook(bot.role, prefix);
  const stats = botStats(bot);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          id={`bot-${bot.id}`}
          aria-label={botLabel(bot, look.name)}
          onClick={() => onOpen(bot.id)}
          className={cn(
            styles.bot,
            "focus-visible:ring-ring flex w-28 flex-col items-center gap-1 rounded-xl p-2 outline-none focus-visible:ring-2",
            "hover:bg-card",
            selectedId === bot.id && "bg-card ring-primary ring-2",
          )}
        >
          <BotFigure
            look={look}
            status={bot.status}
            activeTool={bot.activeTool}
            peakContext={bot.peakContext}
            className="h-24 w-20"
          />
          <span className="max-w-full truncate text-xs font-semibold">{look.name}</span>
          {bot.description ? (
            <span className="text-muted-foreground line-clamp-2 max-w-full text-center text-[11px] leading-tight">
              {bot.description}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs rounded-2xl px-3 py-2">
        <p className="font-semibold">{bot.description ?? look.name}</p>
        {stats.length > 0 ? <p className="opacity-80">{stats.join(" · ")}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}
