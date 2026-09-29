import { describe, expect, it } from "vitest";

import { parseRange, rangeQuery } from "./range";

describe("parseRange", () => {
  it("reads a known range and falls back to 30 days", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange(["90d", "7d"])).toBe("90d");
    expect(parseRange("1y")).toBe("30d");
    expect(parseRange(null)).toBe("30d");
  });
});

describe("rangeQuery", () => {
  it("carries a known range into a query string", () => {
    expect(rangeQuery("7d")).toBe("?range=7d");
    expect(rangeQuery(["90d"])).toBe("?range=90d");
  });

  it("drops a missing or unknown range", () => {
    expect(rangeQuery(undefined)).toBe("");
    expect(rangeQuery(null)).toBe("");
    expect(rangeQuery("1y")).toBe("");
  });
});
