export const RUN_TRACE_PATH = "/dev/run-trace";

// In production the page exists only where RUN_TRACE_TOKEN is set; the token still guards the data.
export function runTracePageEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || Boolean(process.env.RUN_TRACE_TOKEN);
}
