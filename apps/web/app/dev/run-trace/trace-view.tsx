"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pr-review/design";
import { useState } from "react";

import { AgentDetail } from "@/app/dev/run-trace/agent-detail";
import { AgentLanes } from "@/app/dev/run-trace/agent-lanes";
import { BotStage } from "@/app/dev/run-trace/bot-stage";
import { ancestorIds, findAgent } from "@/app/dev/run-trace/trace-layout";
import type { RunTrace } from "@/lib/run-trace/types";

// Selection and collapsed lanes survive a new `trace` for the same run; remount to reset.
export function TraceView({ trace, live = false }: { trace: RunTrace; live?: boolean }) {
  const [selectedId, setSelectedId] = useState<string>(trace.root.id);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const selected = findAgent(trace.root, selectedId) ?? trace.root;

  const select = (id: string) => {
    setSelectedId(id);
    const hidden = ancestorIds(trace.root, id).filter((a) => collapsed.has(a));
    if (hidden.length > 0) setCollapsed(new Set([...collapsed].filter((c) => !hidden.includes(c))));
  };

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  return (
    <Tabs defaultValue="bots">
      <TabsList>
        <TabsTrigger value="bots">Bots</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
      </TabsList>
      <TabsContent value="bots" className="mt-2">
        <BotStage root={trace.root} />
      </TabsContent>
      <TabsContent value="timeline" className="mt-2">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_32rem]">
          <AgentLanes
            root={trace.root}
            collapsed={collapsed}
            selectedId={selected.id}
            onSelect={select}
            onToggle={toggle}
            live={live}
          />
          <AgentDetail agent={selected} onSelect={select} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
