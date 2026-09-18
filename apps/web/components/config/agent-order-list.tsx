"use client";

import { Button, Label, Switch } from "@pr-review/design";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AgentChip } from "@/components/ui";
import { describeAgent, moveAgent, toggleAgent } from "@/lib/agent-config";
import { AGENTS, type AgentName } from "@/lib/data/types";

export type AgentOrderListProps = {
  agents: AgentName[];
  onChange: (next: AgentName[]) => void;
};

type PendingFocus = { agent: AgentName; direction: -1 | 1 };

export function AgentOrderList({ agents, onChange }: AgentOrderListProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const [pending, setPending] = useState<PendingFocus | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // The moved row keeps focus; at an end its button is disabled, so take the other.
  useEffect(() => {
    if (pending === null) return;
    const preferred = buttons.current.get(`${pending.agent}:${pending.direction}`);
    const fallback = buttons.current.get(`${pending.agent}:${-pending.direction}`);
    const target = preferred?.disabled === false ? preferred : fallback;
    target?.focus();
    setPending(null);
  }, [pending, agents]);

  const disabled = AGENTS.filter((agent) => !agents.includes(agent));

  function move(agent: AgentName, index: number, direction: -1 | 1) {
    const next = moveAgent(agents, index, direction);
    if (next === agents) return;
    onChange(next);
    setPending({ agent, direction });
    setAnnouncement(
      `${agent} moved to position ${index + direction + 1} of ${agents.length}.`,
    );
  }

  function setEnabled(agent: AgentName, enabled: boolean) {
    onChange(toggleAgent(agents, agent, enabled));
    setAnnouncement(enabled ? `${agent} enabled.` : `${agent} disabled.`);
  }

  return (
    <div className="min-w-0">
      <p className="eyebrow">Agents, in the order they run</p>
      <p className="mt-1.5 font-mono text-caption leading-relaxed text-slate">
        Order is the order findings reach the synthesiser. Reorder with the arrow
        buttons.
      </p>

      {agents.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-2">
          {agents.map((agent, index) => (
            <li
              key={agent}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-rule-soft bg-surface px-2.5 py-2"
            >
              <span
                aria-hidden
                className="w-4 shrink-0 font-mono text-caption text-slate"
              >
                {index + 1}
              </span>

              <div className="flex min-w-0 flex-1 basis-[14rem] flex-col gap-1">
                <AgentChip agent={agent} className="self-start" />
                <span className="font-mono text-caption leading-relaxed text-slate">
                  {describeAgent(agent)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={index === 0}
                  aria-label={`Move ${agent} up`}
                  ref={(node) => {
                    buttons.current.set(`${agent}:-1`, node);
                  }}
                  onClick={() => move(agent, index, -1)}
                >
                  <ChevronUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={index === agents.length - 1}
                  aria-label={`Move ${agent} down`}
                  ref={(node) => {
                    buttons.current.set(`${agent}:1`, node);
                  }}
                  onClick={() => move(agent, index, 1)}
                >
                  <ChevronDown aria-hidden />
                </Button>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Label htmlFor={`run-${agent}`}>
                  Run<span className="sr-only"> {agent}</span>
                </Label>
                <Switch
                  id={`run-${agent}`}
                  checked
                  onCheckedChange={(checked) => setEnabled(agent, checked)}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 rounded-sm border border-dashed border-rule px-3 py-4 font-mono text-caption text-warn">
          No agents selected. The action fails the step rather than reporting a clean
          review.
        </p>
      )}

      {disabled.length > 0 ? (
        <div className="mt-5">
          <p className="eyebrow">Not running</p>
          <ul className="mt-2 flex flex-col gap-2">
            {disabled.map((agent) => (
              <li
                key={agent}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-dashed border-rule-soft px-2.5 py-2 opacity-80"
              >
                <div className="flex min-w-0 flex-1 basis-[14rem] flex-col gap-1">
                  <AgentChip agent={agent} className="self-start" />
                  <span className="font-mono text-caption leading-relaxed text-slate">
                    {describeAgent(agent)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Label htmlFor={`run-${agent}`}>
                    Run<span className="sr-only"> {agent}</span>
                  </Label>
                  <Switch
                    id={`run-${agent}`}
                    checked={false}
                    onCheckedChange={(checked) => setEnabled(agent, checked)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
