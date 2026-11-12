import { type BotView } from "@/app/dev/run-trace/bot-view";
import { toMs } from "@/app/dev/run-trace/trace-layout";

export type TreeBox = { bot: BotView; waves: TreeBox[][] };

type StageLane = { stage?: string; bots: BotView[] };

export type Floor = { kind: "tree"; root: TreeBox } | { kind: "flat"; lanes: StageLane[] };

export function layoutBots(root: BotView): Floor {
  if (!isFlat(root)) return { kind: "tree", root: box(root) };
  const bots = [...(hasOwnWork(root) || root.children.length === 0 ? [root] : []), ...root.children];
  return { kind: "flat", lanes: byStage(sortByStart(bots)) };
}

// Flat: one level of agents that are stages of a pipeline, under a root that did nothing itself.
export function isFlat(root: BotView): boolean {
  if (root.children.some((child) => child.children.length > 0)) return false;
  if (root.children.length === 0) return false;
  return root.children.some((child) => child.stage !== undefined) || !hasOwnWork(root);
}

function hasOwnWork(bot: BotView): boolean {
  return bot.tools.length > 0 || (bot.events?.length ?? 0) > 0 || bot.thoughts.length > 0;
}

function box(bot: BotView): TreeBox {
  return {
    bot,
    waves: waves(sortByStart(bot.children)).map((wave) => wave.map(box)),
  };
}

/** Overlapping siblings share a wave, so parallel agents stand side by side. */
function waves(sorted: BotView[]): BotView[][] {
  const result: BotView[][] = [];
  let waveEnd = -Infinity;
  for (const bot of sorted) {
    const start = toMs(bot.startedAt);
    const end = Math.max(start, toMs(bot.endedAt));
    const current = result.at(-1);
    if (current && start < waveEnd) {
      current.push(bot);
      waveEnd = Math.max(waveEnd, end);
    } else {
      result.push([bot]);
      waveEnd = end;
    }
  }
  return result;
}

function byStage(sorted: BotView[]): StageLane[] {
  const lanes: StageLane[] = [];
  for (const bot of sorted) {
    const lane = lanes.find((l) => l.stage === bot.stage);
    if (lane) lane.bots.push(bot);
    else lanes.push({ stage: bot.stage, bots: [bot] });
  }
  return lanes;
}

function sortByStart(bots: BotView[]): BotView[] {
  return [...bots].sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt));
}
