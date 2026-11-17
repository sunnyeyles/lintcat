import { castRole, type CastRole } from "@/app/dev/run-trace/bot-look";
import type { LiveRunSummary } from "@/app/dev/run-trace/live-api";

export type BoardRun = LiveRunSummary & { cast: CastRole; stalled: boolean };
export type FactoryBoard = { inProgress: BoardRun[]; waiting: BoardRun[]; finished: BoardRun[] };

const IN_PROGRESS = new Set(["running", "verifying"]);
const WAITING = new Set(["queued", "awaiting_approval", "draft"]);
const FINISHED_SHOWN = 20;

export function stageCast(stage: string | null | undefined): CastRole {
  return (stage ? castRole(stage) : undefined) ?? "locate";
}

const byStart = (a: BoardRun, b: BoardRun) => Date.parse(b.startedAt) - Date.parse(a.startedAt);

export function groupFactoryRuns(runs: readonly LiveRunSummary[], now = Date.now()): FactoryBoard {
  const board: FactoryBoard = { inProgress: [], waiting: [], finished: [] };
  for (const run of runs) {
    if (run.source !== "factory") continue;
    const status = run.status ?? "";
    // An active run whose lease lapsed has lost its worker; another may reclaim it.
    const stalled = IN_PROGRESS.has(status) && !!run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) < now;
    const item = { ...run, cast: stageCast(run.stage), stalled };
    if (IN_PROGRESS.has(status)) board.inProgress.push(item);
    else if (WAITING.has(status)) board.waiting.push(item);
    else board.finished.push(item);
  }
  board.inProgress.sort(byStart);
  board.waiting.sort(byStart);
  board.finished.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  board.finished = board.finished.slice(0, FINISHED_SHOWN);
  return board;
}

export function elapsed(fromIso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
