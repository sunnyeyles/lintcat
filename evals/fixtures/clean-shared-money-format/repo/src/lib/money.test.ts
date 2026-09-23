import { describe, expect, it } from "vitest";

import { formatMoney } from "./money.js";

describe("formatMoney", () => {
  it("formats a two-decimal currency", () => {
    expect(formatMoney(129900, "USD")).toBe("$1,299.00");
  });

  it("formats a zero-decimal currency without dividing by 100", () => {
    expect(formatMoney(1299, "JPY")).toBe("¥1,299");
  });

  it("rejects a currency we do not bill in", () => {
    expect(() => formatMoney(100, "XYZ")).toThrow("unsupported currency XYZ");
  });
});
