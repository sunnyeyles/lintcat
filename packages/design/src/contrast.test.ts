import { describe, expect, it } from "vitest";

import { contrast } from "#src/contrast";
import { type ColorToken, colors } from "#src/tokens";

const GROUNDS = ["paper", "surface", "surface-2"] as const satisfies ColorToken[];
const TEXT = [
  "ink",
  "slate",
  "accent",
  "brand",
  "ok",
  "warn",
  "stop",
  "sev-low",
  "sev-medium",
  "sev-high",
  "agent-docs",
  "agent-security",
  "agent-correctness",
  "agent-performance",
  "agent-tests",
] as const satisfies ColorToken[];

const cases = (tokens: readonly ColorToken[]) =>
  (["light", "dark"] as const).flatMap((theme) =>
    tokens.flatMap((token) =>
      GROUNDS.map((ground) => ({
        theme,
        token,
        ground,
        ratio: contrast(colors[token][theme], colors[ground][theme]),
      })),
    ),
  );

describe("colour contrast", () => {
  it("contrast() matches the WCAG reference pair", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
  });

  it.each(cases(TEXT))("$theme $token on $ground reads as text (4.5:1)", ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  const FILLS: [ColorToken, ColorToken][] = [
    ["accent-ink", "accent"],
    ["accent", "accent-wash"],
    ["brand-ink", "brand"],
    ["brand", "brand-wash"],
    ["paper", "sev-high"],
  ];
  it.each(
    (["light", "dark"] as const).flatMap((theme) =>
      FILLS.map(([fg, bg]) => ({ theme, fg, bg, ratio: contrast(colors[fg][theme], colors[bg][theme]) })),
    ),
  )("$theme $fg on $bg reads as text (4.5:1)", ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases(["slate-dim"]))("$theme slate-dim on $ground is a visible graphic (3:1)", ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it.each(cases(["rule", "rule-soft"]))("$theme $token on $ground stays visible", ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(1.35);
  });
});
