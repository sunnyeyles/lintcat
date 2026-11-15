import {
  factoryEvents,
  getRun,
  listCommands,
  listEvents,
  listRuns,
  openFactoryDatabase,
  type FactoryDatabase,
  type FactoryRun,
} from "@pr-review/factory/store";
import { inArray, max } from "drizzle-orm";

import { FACTORY_RUN_FILE, factoryAdapter, type FactoryRunExport } from "@/lib/run-trace/adapters/factory";
import { LIMITS } from "@/lib/run-trace/adapters/types";
import type { RunTraceConnector, TraceRunSummary } from "@/lib/run-trace/connectors/types";

const OUTPUT_MAX = 8_000;

function summary(run: FactoryRun, lastEventAt?: Date | null): TraceRunSummary {
  const last = [run.updatedAt, run.finishedAt, lastEventAt].filter((d): d is Date => d instanceof Date);
  return {
    runId: run.id,
    title: run.title,
    format: factoryAdapter.id,
    startedAt: run.createdAt,
    lastSeenAt: new Date(Math.max(...last.map((d) => d.getTime()))),
  };
}

/** Reads runs straight from the factory's own Postgres; read-only. */
export function factoryConnector(database: FactoryDatabase): RunTraceConnector {
  return {
    id: "factory",
    label: "lintcat factory",
    async list(limit) {
      const runs = await listRuns(database, { limit });
      if (runs.length === 0) return [];
      const latest = await database
        .select({ runId: factoryEvents.runId, at: max(factoryEvents.at) })
        .from(factoryEvents)
        .where(inArray(factoryEvents.runId, runs.map((run) => run.id)))
        .groupBy(factoryEvents.runId);
      const byRun = new Map(latest.map((row) => [row.runId, row.at]));
      return runs.map((run) => summary(run, byRun.get(run.id)));
    },
    async read(runId) {
      const run = await getRun(database, runId);
      if (!run) return undefined;
      const [events, commands] = await Promise.all([
        listEvents(database, runId, { limit: LIMITS.records }),
        listCommands(database, runId),
      ]);
      const exported: FactoryRunExport = {
        run: {
          id: run.id,
          title: run.title,
          status: run.status,
          stage: run.stage,
          profile: run.profile,
          blocker: run.blocker,
          outcome: run.outcome ? { ...run.outcome } : null,
          createdAt: run.createdAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        },
        events: events.map((e) => ({ id: e.id, at: e.at.toISOString(), kind: e.kind, stage: e.stage, agentId: e.agentId, data: e.data })),
        commands: commands.slice(0, LIMITS.records).map((c) => ({
          ...c,
          startedAt: c.startedAt.toISOString(),
          output: c.output.length > OUTPUT_MAX ? `${c.output.slice(0, OUTPUT_MAX)}…` : c.output,
        })),
      };
      const lastEventAt = events.at(-1)?.at;
      return { run: summary(run, lastEventAt), files: [{ name: FACTORY_RUN_FILE, text: JSON.stringify(exported) }] };
    },
  };
}

const cache = globalThis as { factoryTraceConnector?: RunTraceConnector };

/** Off unless FACTORY_DATABASE_URL is set; one pool per server process. */
export function factoryConnectorFromEnv(env: NodeJS.ProcessEnv = process.env): RunTraceConnector | undefined {
  const url = env.FACTORY_DATABASE_URL;
  if (!url) return undefined;
  cache.factoryTraceConnector ??= factoryConnector(openFactoryDatabase(url).database);
  return cache.factoryTraceConnector;
}
