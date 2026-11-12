import { describe, expect, it } from "vitest";

import { botLook, commonPrefix, displayRole } from "./bot-look";
import { roleColor } from "./trace-layout";

describe("botLook", () => {
  it.each([
    ["marrow-planner", "clipboard"],
    ["marrow-test-writer", "magnifier"],
    ["marrow-implementer", "wrench"],
    ["code-monkey", "wrench"],
    ["builder", "wrench"],
    ["marrow-reviewer", "glasses"],
    ["marrow-skeptic", "eyebrow"],
    ["critic", "eyebrow"],
    ["qa", "eyebrow"],
    ["main", "hat"],
    ["root", "hat"],
    ["run", "hat"],
  ])("%s wears a %s", (role, accessory) => {
    expect(botLook(role).accessory).toBe(accessory);
  });

  it("does not read a hat into a word that merely contains run", () => {
    expect(botLook("test-runner").accessory).toBe("magnifier");
  });

  it("gives unknown roles a stable spare accessory", () => {
    const first = botLook("summarizer");
    expect(["antenna", "propeller", "headphones", "bowtie", "flower"]).toContain(first.accessory);
    expect(botLook("summarizer")).toEqual(first);
    const spares = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map((r) => botLook(r).accessory));
    expect(spares.size).toBeGreaterThan(1);
  });

  it("takes its colour from roleColor", () => {
    expect(botLook("marrow-reviewer").color).toBe(roleColor("marrow-reviewer"));
  });
});

describe("role names", () => {
  it("strips a namespace every role shares", () => {
    expect(commonPrefix(["main", "acme-plan", "acme-fix"])).toBe("acme-");
    expect(commonPrefix(["acme-plan", "other-fix"])).toBe("");
    expect(commonPrefix(["acme-plan"])).toBe("");
    expect(displayRole("acme-plan", "acme-")).toBe("plan");
    expect(botLook("acme-plan", "acme-").name).toBe("plan");
  });

  it("always strips marrow-, but never down to nothing", () => {
    expect(displayRole("marrow-implementer")).toBe("implementer");
    expect(displayRole("marrow")).toBe("marrow");
  });
});
