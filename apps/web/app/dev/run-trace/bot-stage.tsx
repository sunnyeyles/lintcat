"use client";

import { useMemo, useState } from "react";

import { BotCard } from "@/app/dev/run-trace/bot-card";
import { BotFloor } from "@/app/dev/run-trace/bot-floor";
import { layoutBots } from "@/app/dev/run-trace/bot-layout";
import { commonPrefix } from "@/app/dev/run-trace/bot-look";
import { toBotView, walkBots } from "@/app/dev/run-trace/bot-view";
import type { AgentNode } from "@/lib/run-trace/types";

export function BotStage({ root }: { root: AgentNode }) {
  const { floor, bots, prefix } = useMemo(() => {
    const view = toBotView(root);
    const all = [...walkBots(view)];
    return {
      floor: layoutBots(view),
      bots: new Map(all.map((bot) => [bot.id, bot])),
      prefix: commonPrefix(all.map((bot) => bot.role)),
    };
  }, [root]);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (bots.get(openId) ?? null) : null;

  const jump = (id: string) => {
    setOpenId(id);
    document.getElementById(`bot-${id}`)?.scrollIntoView({ block: "nearest", inline: "center" });
  };

  return (
    <>
      <BotFloor floor={floor} prefix={prefix} selectedId={openId} onOpen={setOpenId} />
      <BotCard bot={open} prefix={prefix} bots={bots} onClose={() => setOpenId(null)} onJump={jump} />
    </>
  );
}
