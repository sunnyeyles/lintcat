export const RUN_TRACE_PATH = "/dev/run-trace";

// Dropped files never leave the browser; only pushed runs need the token's protection.
export function liveRunsEnabled(): boolean {
  return Boolean(process.env.RUN_TRACE_TOKEN);
}
