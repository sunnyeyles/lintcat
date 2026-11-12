"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@pr-review/design";
import { ArrowRight } from "@pr-review/design/icons";
import type { ReactNode } from "react";

import { ContextChart } from "@/app/dev/run-trace/context-chart";
import {
  activityLabel,
  agentStats,
  formatCost,
  formatDuration,
  formatTokens,
  roleColor,
  toMs,
} from "@/app/dev/run-trace/trace-layout";
import type { AgentNode, AgentStatus, AgentStep, ToolCall, TraceEvent } from "@/lib/run-trace/types";

const STATUS_BADGE: Record<AgentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  running: "secondary",
  done: "outline",
  failed: "destructive",
  cancelled: "outline",
};

export function AgentDetail({ agent, onSelect }: { agent: AgentNode; onSelect: (id: string) => void }) {
  const stats = agentStats(agent);
  const start = toMs(agent.startedAt);
  const promptIndex = agent.steps.findIndex((step) => step.kind === "prompt");
  const prompt = promptIndex >= 0 ? agent.steps[promptIndex] : undefined;
  const steps = agent.steps.filter((_, i) => i !== promptIndex);
  const childById = new Map(agent.children.map((child) => [child.id, child]));

  return (
    <Card className="min-w-0 gap-4 self-start xl:sticky xl:top-4">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: roleColor(agent.role) }} />
          {agent.role}
          {agent.stage && agent.stage !== agent.role ? <Badge variant="outline">{agent.stage}</Badge> : null}
          {agent.status ? <Badge variant={STATUS_BADGE[agent.status]}>{agent.status}</Badge> : null}
        </CardTitle>
        <CardDescription>
          {[agent.description, agent.model, formatDuration(stats.durationMs), activityLabel(stats), `peak ${formatTokens(stats.peakContext)}`, formatCost(agent.cost)]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {agent.error ? (
          <p className="border-destructive text-destructive rounded-md border px-2.5 py-1.5 text-sm whitespace-pre-wrap">{agent.error}</p>
        ) : null}

        <Section title="Context window">
          <ContextChart agent={agent} />
        </Section>

        {prompt && prompt.kind === "prompt" ? (
          <Section title="Prompt">
            <p className="bg-surface-2 max-h-40 overflow-auto rounded-md p-2.5 text-sm whitespace-pre-wrap">{prompt.text}</p>
          </Section>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FileList title="Files read" files={agent.filesRead} />
          <FileList title="Files edited" files={agent.filesEdited} />
        </div>

        <Section title={`Steps (${steps.length})`}>
          <ol className="max-h-[32rem] space-y-1.5 overflow-auto pr-1">
            {steps.map((step, i) => (
              <li key={i}>
                <StepView step={step} start={start} child={step.kind === "tool" && step.call.childAgentId ? childById.get(step.call.childAgentId) : undefined} onSelect={onSelect} />
              </li>
            ))}
          </ol>
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  );
}

function FileList({ title, files }: { title: string; files: string[] }) {
  return (
    <Section title={`${title} (${files.length})`}>
      {files.length === 0 ? (
        <p className="text-muted-foreground text-xs">None recorded. Files touched through shell commands are not tracked.</p>
      ) : (
        <ul className="max-h-36 space-y-0.5 overflow-auto font-mono text-xs">
          {files.map((file) => (
            <li key={file} className="truncate" title={file}>
              {file}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function offset(timestamp: string, start: number): string {
  return `+${formatDuration(Math.max(0, toMs(timestamp) - start))}`;
}

function Stamp({ timestamp, start }: { timestamp: string; start: number }) {
  return <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">{offset(timestamp, start)}</span>;
}

function StepView({
  step,
  start,
  child,
  onSelect,
}: {
  step: AgentStep;
  start: number;
  child?: AgentNode;
  onSelect: (id: string) => void;
}) {
  if (step.kind === "tool") return <ToolView call={step.call} start={start} child={child} onSelect={onSelect} />;
  if (step.kind === "event") return <EventView event={step.event} start={start} />;
  if (step.kind === "thinking" && step.text.trim() === "") {
    return (
      <div className="flex items-baseline gap-2 px-2 py-1 text-sm">
        <Stamp timestamp={step.timestamp} start={start} />
        <span className="text-muted-foreground italic">Thinking (redacted)</span>
      </div>
    );
  }
  if (step.kind === "thinking") {
    return (
      <details className="group rounded-md border border-dashed px-2 py-1">
        <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm">
          <Stamp timestamp={step.timestamp} start={start} />
          <span className="text-muted-foreground min-w-0 truncate italic group-open:whitespace-normal">
            Thinking: {firstLine(step.text)}
          </span>
        </summary>
        <p className="text-muted-foreground mt-1 pl-16 text-sm whitespace-pre-wrap italic">{step.text}</p>
      </details>
    );
  }
  return (
    <div className="flex items-baseline gap-2 px-2 py-1 text-sm">
      <Stamp timestamp={step.timestamp} start={start} />
      <p className={cn("min-w-0 whitespace-pre-wrap", step.kind === "prompt" && "font-medium")}>
        {step.kind === "prompt" ? "User: " : ""}
        {step.text}
      </p>
    </div>
  );
}

function ToolView({
  call,
  start,
  child,
  onSelect,
}: {
  call: ToolCall;
  start: number;
  child?: AgentNode;
  onSelect: (id: string) => void;
}) {
  const childId = call.childAgentId;
  const header = (
    <>
      <Stamp timestamp={call.timestamp} start={start} />
      <Badge variant={call.isError ? "destructive" : "secondary"} className="font-mono">
        {call.name}
      </Badge>
      <span className="min-w-0 truncate font-mono text-xs" title={call.summary}>
        {call.summary}
      </span>
    </>
  );
  return (
    <div className={cn("rounded-md border px-2 py-1", call.isError && "border-destructive")}>
      {call.result ? (
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2">{header}</summary>
          <pre className="bg-surface-2 mt-1 max-h-60 overflow-auto rounded-sm p-2 font-mono text-xs whitespace-pre-wrap">
            {call.result}
          </pre>
        </details>
      ) : (
        <div className="flex items-center gap-2">{header}</div>
      )}
      {childId ? (
        <Button
          size="xs"
          variant="link"
          className="ml-16 h-auto px-0"
          onClick={() => onSelect(childId)}
        >
          Open {child ? child.role : childId}
          {child?.description ? `: ${child.description}` : ""}
          <ArrowRight animate="none" />
        </Button>
      ) : null}
    </div>
  );
}

function EventView({ event, start }: { event: TraceEvent; start: number }) {
  const failed = event.status === "error";
  const header = (
    <>
      <Stamp timestamp={event.timestamp} start={start} />
      <Badge variant={failed ? "destructive" : "outline"} className="font-mono">
        {event.category === "other" ? event.name : `${event.category}: ${event.name}`}
      </Badge>
      {event.status === "running" ? <Badge variant="secondary">running</Badge> : null}
      <span className="min-w-0 truncate font-mono text-xs" title={event.text}>
        {event.text}
      </span>
      {event.durationMs !== undefined ? (
        <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">{formatDuration(event.durationMs)}</span>
      ) : null}
    </>
  );
  return (
    <div className={cn("bg-surface-2 rounded-md border border-dashed px-2 py-1", failed && "border-destructive")}>
      {event.detail ? (
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2">{header}</summary>
          <pre className="bg-card mt-1 max-h-60 overflow-auto rounded-sm p-2 font-mono text-xs whitespace-pre-wrap">
            {event.detail}
          </pre>
        </details>
      ) : (
        <div className="flex items-center gap-2">{header}</div>
      )}
    </div>
  );
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}
