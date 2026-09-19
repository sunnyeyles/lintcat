import { describe, expect, it } from "vitest";

import { cn } from "#src/cn";

describe("cn", () => {
  it("keeps a scale size beside a text colour", () => {
    expect(cn("text-caption text-slate")).toBe("text-caption text-slate");
  });

  it("lets a later scale size override an earlier one", () => {
    expect(cn("text-caption", "text-body")).toBe("text-body");
  });

  it("reads a CSS-variable text colour as a colour, not a size", () => {
    expect(cn("text-caption text-(--chip)", "text-slate")).toBe("text-caption text-slate");
  });

  it("treats scale radius and tracking as their own groups", () => {
    expect(cn("rounded-xs tracking-caps", "rounded-sm tracking-ui")).toBe("rounded-sm tracking-ui");
  });
});
