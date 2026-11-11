/** One recorder per run: Postgres rows, the local events.jsonl and OpenTelemetry spans, correlated. */
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { appendEventLine } from "#src/run-files";
import { appendEvent, recordCommand, type FactoryDatabase } from "#src/store/index";

const tracer = trace.getTracer("lintcat-factory");

export const TOOL_VERSION = "factory@0.1.0";

export interface RunContext {
  runId: string;
  taskId: string;
  repoPath: string;
  workflowVersion: string | null;
}

interface EventInput {
  kind: string;
  stage?: string;
  agentId?: string;
  promptVersion?: string;
  repositorySha?: string;
  data?: Record<string, unknown>;
}

interface CommandRecord {
  stage: string;
  name: string;
  command: string;
  cwd: string;
  startedAt: Date;
  durationMs: number;
  exitCode: number;
  timedOut: boolean;
  errorCategory: string | null;
  outputHash: string;
  output: string;
}

export interface Recorder {
  event(input: EventInput): Promise<void>;
  command(record: CommandRecord): Promise<void>;
  stage<T>(stage: string, work: (span: Span) => Promise<T>): Promise<T>;
}

export function createRecorder(database: FactoryDatabase, context: RunContext, logger: StructuredLogger): Recorder {
  const base = { runId: context.runId, workflowVersion: context.workflowVersion ?? undefined, toolVersion: TOOL_VERSION };
  return {
    async event(input) {
      const row = { ...base, ...input, data: input.data ?? {} };
      await appendEvent(database, row);
      const at = new Date().toISOString();
      await appendEventLine(context.repoPath, context.runId, { at, taskId: context.taskId, ...row }).catch(
        (error: unknown) => logger.error("events.jsonl append failed", { error: errorMessage(error) }),
      );
      trace.getActiveSpan()?.addEvent(input.kind, { "factory.stage": input.stage ?? "" });
      logger.info(input.kind, { runId: context.runId, stage: input.stage, ...(input.data ?? {}) });
    },
    async command(record) {
      await recordCommand(database, { runId: context.runId, ...record });
      if (record.exitCode !== 0) {
        logger.error("command failed", { runId: context.runId, name: record.name, exitCode: record.exitCode });
      }
    },
    stage(stage, work) {
      return tracer.startActiveSpan(
        `factory.${stage}`,
        { attributes: { "factory.run_id": context.runId, "factory.task_id": context.taskId, "factory.stage": stage } },
        async (span) => {
          try {
            return await work(span);
          } catch (error) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };
}
