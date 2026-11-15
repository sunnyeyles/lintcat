import { claudeCodeAdapter } from "@/lib/run-trace/adapters/claude-code";
import { factoryAdapter } from "@/lib/run-trace/adapters/factory";
import { lintcatAdapter } from "@/lib/run-trace/adapters/lintcat";
import { openAiAgentsAdapter } from "@/lib/run-trace/adapters/openai-agents";
import { otelAdapter } from "@/lib/run-trace/adapters/otel";
import { LIMITS, type RunFile, type TraceAdapter } from "@/lib/run-trace/adapters/types";
import type { RunTrace } from "@/lib/run-trace/types";

export const ADAPTERS: readonly TraceAdapter[] = [
  claudeCodeAdapter,
  otelAdapter,
  openAiAgentsAdapter,
  lintcatAdapter,
  factoryAdapter,
];

export const FORMAT_IDS = ADAPTERS.map((adapter) => adapter.id);

export function findAdapter(id: string): TraceAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}

export class UnsupportedTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTraceError";
  }
}

function supportedFormatsText(): string {
  return ADAPTERS.map((adapter) => `${adapter.label}: ${adapter.hint}`).join("\n");
}

function checkLimits(files: readonly RunFile[]): void {
  if (files.length > LIMITS.files) throw new UnsupportedTraceError(`Too many files: ${files.length} (limit ${LIMITS.files}).`);
  const bytes = files.reduce((sum, file) => sum + file.text.length, 0);
  if (bytes > LIMITS.bytes) throw new UnsupportedTraceError(`Too much data: ${Math.round(bytes / 1e6)} MB (limit ${LIMITS.bytes / 1024 / 1024} MB).`);
}

export type Detection = { adapter: TraceAdapter; confidence: number };

/** Every adapter's confidence, best first; a throwing detector counts as 0. */
export function detectFormats(files: readonly RunFile[]): Detection[] {
  return ADAPTERS.map((adapter) => {
    let confidence = 0;
    try {
      confidence = Math.min(1, Math.max(0, adapter.detect(files)));
    } catch {
      confidence = 0;
    }
    return { adapter, confidence };
  })
    .filter((d) => d.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

export function detectFormat(files: readonly RunFile[]): TraceAdapter | undefined {
  return detectFormats(files)[0]?.adapter;
}

export type ParsedTrace = { trace: RunTrace; adapter: TraceAdapter };

/** Parses with `format`, or the best detected adapter; throws `UnsupportedTraceError` with what is supported. */
export function parseTrace(files: readonly RunFile[], format?: string): ParsedTrace {
  checkLimits(files);
  const adapter = format ? findAdapter(format) : detectFormat(files);
  if (!adapter) {
    throw new UnsupportedTraceError(
      format
        ? `Unknown format "${format}". Supported: ${FORMAT_IDS.join(", ")}.`
        : `Couldn't read this as any supported format. We support:\n${supportedFormatsText()}`,
    );
  }
  let trace: RunTrace;
  try {
    trace = adapter.parse(files);
  } catch (cause) {
    throw new UnsupportedTraceError(`Couldn't read this as ${adapter.label}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return { trace: { ...trace, format: adapter.id }, adapter };
}
