import { afterEach, describe, expect, it, vi } from "vitest";

import { liveRunsEnabled } from "@/lib/run-trace-page";

describe("liveRunsEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("follows RUN_TRACE_TOKEN", () => {
    vi.stubEnv("RUN_TRACE_TOKEN", "");
    expect(liveRunsEnabled()).toBe(false);
    vi.stubEnv("RUN_TRACE_TOKEN", "secret");
    expect(liveRunsEnabled()).toBe(true);
  });
});
