import { describe, expect, it } from "vitest";

import { heatLabel, heatOf, heatOfPaths, NO_HEAT } from "./heat";

const counts = (total: number, high = 0, medium = 0, low = 0) => ({ total, high, medium, low });

describe("heatOf", () => {
  it("takes the worst severity present", () => {
    expect(heatOf(counts(3, 1, 1, 1)).top).toBe("high");
    expect(heatOf(counts(2, 0, 1, 1)).top).toBe("medium");
    expect(heatOf(counts(1, 0, 0, 1)).top).toBe("low");
  });

  it("bands the total so the ring thickness carries the count", () => {
    expect(heatOf(counts(1, 1)).band).toBe(1);
    expect(heatOf(counts(2, 2)).band).toBe(1);
    expect(heatOf(counts(3, 3)).band).toBe(2);
    expect(heatOf(counts(9, 9)).band).toBe(3);
  });

  it("treats no counts and a zero total alike", () => {
    expect(heatOf(undefined)).toBe(NO_HEAT);
    expect(heatOf(counts(0))).toBe(NO_HEAT);
  });
});

describe("heatOfPaths", () => {
  it("sums the files it is given and skips the ones with nothing", () => {
    const heat = { "a.ts": counts(2, 1, 0, 1), "b.ts": counts(1, 0, 1, 0) };

    expect(heatOfPaths(heat, ["a.ts", "b.ts", "c.ts"])).toEqual({
      counts: counts(3, 1, 1, 1),
      top: "high",
      band: 2,
    });
    expect(heatOfPaths(heat, ["c.ts"]).band).toBe(0);
  });
});

describe("heatLabel", () => {
  it("names only the severities that are there", () => {
    expect(heatLabel(heatOf(counts(3, 2, 0, 1)))).toBe("3 findings: 2 high, 1 low");
    expect(heatLabel(heatOf(counts(1, 1)))).toBe("1 finding: 1 high");
    expect(heatLabel(NO_HEAT)).toBe("No findings");
  });
});
