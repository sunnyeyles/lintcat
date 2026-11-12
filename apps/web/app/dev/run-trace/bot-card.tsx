"use client";

import { Badge, cn, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@pr-review/design";
import { ArrowRight, ChevronDown } from "@pr-review/design/icons";
import type { ReactNode } from "react";

import { BotFigure } from "@/app/dev/run-trace/bot-figure";
import { botLook } from "@/app/dev/run-trace/bot-look";
import { botStats, type BotEvent, type BotThought, type BotTool, type BotView } from "@/app/dev/run-trace/bot-view";
import { ContextChart } from "@/app/dev/run-trace/context-chart";
import { formatDuration, toMs } from "@/app/dev/run-trace/trace-layout";

type Moment =
  | { kind: "tool"; at: number; tool: BotTool }
  | { kind: "event"; at: number; event: BotEvent }
  | { kind: "said"; at: number; said: BotThought };

function timeline(bot: BotView): Moment[] {
  const moments: Moment[] = [
    ...bot.tools.map((tool) => ({
      kind: "tool" as const,
      at: toMs(tool.timestamp),
      tool,
    })),
    ...(bot.events ?? []).map((event) => ({
      kind: "event" as const,
      at: toMs(event.timestamp),
      event,
    })),
    ...bot.said.map((said) => ({
      kind: "said" as const,
      at: toMs(said.timestamp),
      said,
    })),
  ];
  return moments.sort((a, b) => a.at - b.at);
}

export function BotCard({
  bot,
  prefix,
  bots,
  onClose,
  onJump,
}: {
  bot: BotView | null;
  prefix: string;
  bots: ReadonlyMap<string, BotView>;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  return (
    <Sheet open={bot !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {bot ? <CardBody bot={bot} prefix={prefix} bots={bots} onJump={onJump} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function CardBody({
  bot,
  prefix,
  bots,
  onJump,
}: {
  bot: BotView;
  prefix: string;
  bots: ReadonlyMap<string, BotView>;
  onJump: (id: string) => void;
}) {
  const look = botLook(bot.role, prefix);
  const stats = botStats(bot);
  const moments = timeline(bot);
  const start = toMs(bot.startedAt);
  const files = bot.filesRead.length + bot.filesEdited.length;

  return (
    <>
      <SheetHeader className="bg-surface-2 items-center border-b pt-8 text-center">
        <BotFigure
          look={look}
          status={bot.status}
          activeTool={bot.activeTool}
          peakContext={bot.peakContext}
          className="h-36 w-32"
        />
        <SheetTitle className="text-xl">Hi, I'm {look.name}</SheetTitle>
        <SheetDescription className="flex flex-wrap justify-center gap-1.5">
          {bot.status ? <StatusBadge status={bot.status} /> : null}
          {bot.stage ? <Badge variant="outline">stage: {bot.stage}</Badge> : null}
          {[...stats, bot.model].filter(Boolean).map((stat) => (
            <Badge key={stat} variant="secondary">
              {stat}
            </Badge>
          ))}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 p-4">
        {bot.prompt ? (
          <Section title="My job">
            <p className="bg-surface-2 max-h-48 overflow-auto rounded-lg p-3 text-sm whitespace-pre-wrap">
              {bot.prompt}
            </p>
          </Section>
        ) : null}

        {moments.length > 0 ? (
          <Section title="What I did">
            <ol className="space-y-1.5">
              {moments.map((moment, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground w-14 shrink-0 pt-1 text-right text-xs tabular-nums">
                    {start && moment.at ? `+${formatDuration(Math.max(0, moment.at - start))}` : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <MomentView moment={moment} bots={bots} prefix={prefix} onJump={onJump} />
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {files > 0 ? (
          <Section title="Files I touched">
            <div className="grid gap-4 sm:grid-cols-2">
              <FileList title="Edited" files={bot.filesEdited} />
              <FileList title="Read" files={bot.filesRead} />
            </div>
          </Section>
        ) : null}

        {bot.context.length > 0 ? (
          <Section title="How full my head got">
            <ContextChart agent={bot} />
          </Section>
        ) : null}

        {bot.thoughts.length > 0 ? (
          <Section title="My thoughts">
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                <ChevronDown animate="none" className="size-4 transition-transform group-open:rotate-180" />
                {bot.thoughts.length} {bot.thoughts.length === 1 ? "thought" : "thoughts"}
              </summary>
              <ul className="space-y-2 border-t p-3">
                {bot.thoughts.map((thought, i) => (
                  <li key={i} className="text-muted-foreground text-sm whitespace-pre-wrap italic">
                    {thought.text}
                  </li>
                ))}
              </ul>
            </details>
          </Section>
        ) : null}

        {!bot.prompt && moments.length === 0 && files === 0 && bot.context.length === 0 && bot.thoughts.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            This run didn't record what I did, only that I was here.
          </p>
        ) : null}
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: NonNullable<BotView["status"]> }) {
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  if (status === "running") return <Badge>working…</Badge>;
  return <Badge className="bg-success text-success-foreground">done</Badge>;
}

function MomentView({
  moment,
  bots,
  prefix,
  onJump,
}: {
  moment: Moment;
  bots: ReadonlyMap<string, BotView>;
  prefix: string;
  onJump: (id: string) => void;
}) {
  if (moment.kind === "said") {
    return <p className="border-primary border-l-2 py-0.5 pl-2 text-sm whitespace-pre-wrap">{moment.said.text}</p>;
  }
  if (moment.kind === "event") {
    const { event } = moment;
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Badge
          variant={event.ok === false ? "destructive" : "outline"}
          className={cn(event.ok === true && "border-success text-success")}
        >
          {event.ok === true ? "pass" : event.ok === false ? "fail" : event.kind}
        </Badge>
        <span className="min-w-0 truncate font-mono text-xs" title={event.label}>
          {event.label}
        </span>
      </div>
    );
  }
  const { tool } = moment;
  const child = tool.childId ? bots.get(tool.childId) : undefined;
  if (child) {
    return (
      <button
        type="button"
        onClick={() => onJump(child.id)}
        className="hover:bg-surface-2 focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-left outline-none focus-visible:ring-2"
      >
        <Badge className="font-mono">{tool.name}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm">
          Sent {botLook(child.role, prefix).name}
          {child.description ? `: ${child.description}` : ""}
        </span>
        <ArrowRight animate="none" className="size-4 shrink-0" />
      </button>
    );
  }
  const header = (
    <>
      <Badge variant={tool.isError ? "destructive" : "secondary"} className="font-mono">
        {tool.name}
      </Badge>
      <span className="min-w-0 truncate font-mono text-xs" title={tool.summary}>
        {tool.summary}
      </span>
    </>
  );
  if (!tool.result) return <div className="flex min-w-0 items-center gap-2 py-0.5">{header}</div>;
  return (
    <details>
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 py-0.5">{header}</summary>
      <pre className="bg-surface-2 mt-1 max-h-48 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
        {tool.result}
      </pre>
    </details>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function FileList({ title, files }: { title: string; files: string[] }) {
  if (files.length === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title} ({files.length})
      </h4>
      <ul className="max-h-36 space-y-0.5 overflow-auto font-mono text-xs">
        {files.map((file) => (
          <li key={file} className="truncate" title={file}>
            {file}
          </li>
        ))}
      </ul>
    </div>
  );
}
