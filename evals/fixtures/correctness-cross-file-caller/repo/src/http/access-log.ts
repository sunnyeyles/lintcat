/** One JSON line per handled request, written to whatever sink is wired in. */

export type LogSink = (line: string) => void;

export interface AccessLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export function writeAccessLog(sink: LogSink, entry: AccessLogEntry): void {
  sink(JSON.stringify({ kind: "access", ...entry }));
}

/** Times the handler and logs the result, whether or not it threw. */
export async function withAccessLog<T>(
  sink: LogSink,
  method: string,
  path: string,
  handle: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const startedAt = Date.now();
  try {
    const result = await handle();
    writeAccessLog(sink, {
      method,
      path,
      status: result.status,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    writeAccessLog(sink, {
      method,
      path,
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
