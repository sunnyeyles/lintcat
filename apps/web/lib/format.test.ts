import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatNumber,
  formatRelative,
  formatTokens,
  formatUsd,
  shortSha,
} from "./format";

describe("formatNumber", () => {
  it("separates thousands", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("leaves small numbers alone", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });

  it("caps fraction digits and keeps the sign", () => {
    expect(formatNumber(1234.5678)).toBe("1,234.57");
    expect(formatNumber(-4200)).toBe("-4,200");
  });

  it("returns a dash for non-finite input", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatTokens", () => {
  it("passes through below a thousand", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("switches units at each boundary", () => {
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(12300)).toBe("12.3k");
    expect(formatTokens(4200000)).toBe("4.2M");
    expect(formatTokens(2_500_000_000)).toBe("2.5B");
  });

  it("promotes a value that rounds up into the next unit", () => {
    expect(formatTokens(999_999)).toBe("1M");
  });

  it("drops a trailing zero decimal", () => {
    expect(formatTokens(2000)).toBe("2k");
  });

  it("handles negatives and non-finite input", () => {
    expect(formatTokens(-12300)).toBe("-12.3k");
    expect(formatTokens(Number.NaN)).toBe("—");
  });
});

describe("formatUsd", () => {
  it("renders cents", () => {
    expect(formatUsd(1.23)).toBe("$1.23");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("uses four decimals below a cent", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.000012)).toBe("$0.0000");
  });

  it("keeps two decimals exactly at a cent", () => {
    expect(formatUsd(0.01)).toBe("$0.01");
  });

  it("puts the sign before the symbol", () => {
    expect(formatUsd(-1.5)).toBe("-$1.50");
  });

  it("returns a dash for non-finite input", () => {
    expect(formatUsd(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("uses milliseconds below a second", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("uses one decimal second below a minute", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(1400)).toBe("1.4s");
    expect(formatDuration(59_900)).toBe("59.9s");
  });

  it("uses minutes and seconds below an hour", () => {
    expect(formatDuration(133_000)).toBe("2m 13s");
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("uses hours and minutes above an hour", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(3_840_000)).toBe("1h 4m");
  });

  it("returns a dash for non-finite input", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("collapses the last minute", () => {
    expect(formatRelative(ago(5_000), now)).toBe("just now");
  });

  it("steps through minutes, hours and days", () => {
    expect(formatRelative(ago(3 * 60_000), now)).toBe("3m ago");
    expect(formatRelative(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(formatRelative(ago(2 * 86_400_000), now)).toBe("2d ago");
  });

  it("steps through months and years", () => {
    expect(formatRelative(ago(45 * 86_400_000), now)).toBe("1mo ago");
    expect(formatRelative(ago(800 * 86_400_000), now)).toBe("2y ago");
  });

  it("reads a timestamp or an ISO string", () => {
    expect(formatRelative(ago(3_600_000).toISOString(), now)).toBe("1h ago");
    expect(formatRelative(ago(3_600_000).getTime(), now.getTime())).toBe("1h ago");
  });

  it("handles future dates", () => {
    expect(formatRelative(new Date(now.getTime() + 3 * 3_600_000), now)).toBe("in 3h");
  });

  it("returns a dash for an unparseable date", () => {
    expect(formatRelative("not-a-date", now)).toBe("—");
  });
});

describe("shortSha", () => {
  it("takes the first seven characters", () => {
    expect(shortSha("9f1c0a2b3d4e5f60718293a4b5c6d7e8f9012345")).toBe("9f1c0a2");
  });

  it("leaves an already-short sha intact", () => {
    expect(shortSha("abc")).toBe("abc");
    expect(shortSha("")).toBe("");
  });

  it("trims surrounding whitespace first", () => {
    expect(shortSha("  9f1c0a2b3d4e  ")).toBe("9f1c0a2");
  });
});
