import { afterEach, describe, expect, it, vi } from "vitest";

import { runTracePageEnabled } from "@/lib/run-trace-page";

describe("runTracePageEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is always on outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RUN_TRACE_TOKEN", "");
    expect(runTracePageEnabled()).toBe(true);
  });

  it("needs RUN_TRACE_TOKEN in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUN_TRACE_TOKEN", "");
    expect(runTracePageEnabled()).toBe(false);
    vi.stubEnv("RUN_TRACE_TOKEN", "secret");
    expect(runTracePageEnabled()).toBe(true);
  });
});
