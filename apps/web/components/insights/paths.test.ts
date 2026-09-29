import { describe, expect, it } from "vitest";

import { insightsHref, insightsTabs, isActiveTab } from "./paths";

describe("insightsTabs", () => {
  it("lists both tabs under the organization's Insights route", () => {
    expect(insightsTabs("acme")).toEqual([
      { href: "/o/acme/insights", label: "Trends" },
      { href: "/o/acme/insights/cost", label: "Tokens & cost" },
    ]);
  });
});

describe("isActiveTab", () => {
  const trends = "/o/acme/insights";
  const cost = "/o/acme/insights/cost";

  it("matches only the tab's own route", () => {
    expect(isActiveTab("/o/acme/insights", trends)).toBe(true);
    expect(isActiveTab("/o/acme/insights", cost)).toBe(false);
    expect(isActiveTab("/o/acme/insights/cost/", cost)).toBe(true);
    expect(isActiveTab("/o/acme/insights/cost", trends)).toBe(false);
  });

  it("matches a subdomain path without the organization prefix", () => {
    expect(isActiveTab("/insights", trends)).toBe(true);
    expect(isActiveTab("/insights/cost", cost)).toBe(true);
  });
});

describe("insightsHref", () => {
  it("keeps a known range", () => {
    expect(insightsHref("acme", "trends", "7d")).toBe("/o/acme/insights?range=7d");
    expect(insightsHref("acme", "cost", ["90d"])).toBe("/o/acme/insights/cost?range=90d");
  });

  it("drops a missing or unknown range", () => {
    expect(insightsHref("acme", "cost", undefined)).toBe("/o/acme/insights/cost");
    expect(insightsHref("acme", "trends", "1y")).toBe("/o/acme/insights");
  });
});
