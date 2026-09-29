import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_GRAPH_CODE } from "@/lib/codebase-map";

import { fetchMapPayload } from "./adapter";

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMapPayload", () => {
  it("asks the endpoint for the opening payload and returns it", async () => {
    const payload = { mode: "full", graph: { files: [], imports: [] }, heat: {}, changedPaths: [] };
    const fetch = answer(200, payload);

    expect(await fetchMapPayload("/api/codebase-map/acme/7")).toEqual(payload);
    expect(fetch).toHaveBeenCalledWith(
      "/api/codebase-map/acme/7",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "first" }) }),
    );
  });

  it("is null for a review stored without a graph", async () => {
    answer(404, { error: "no repository graph for this review", code: NO_GRAPH_CODE });
    expect(await fetchMapPayload("/map")).toBeNull();
  });

  it("throws for a review the reader may not have, or a failed request", async () => {
    answer(404, { error: "review not found" });
    await expect(fetchMapPayload("/map")).rejects.toThrow("map request failed: 404");

    answer(500, { error: "boom" });
    await expect(fetchMapPayload("/map")).rejects.toThrow("map request failed: 500");
  });
});
