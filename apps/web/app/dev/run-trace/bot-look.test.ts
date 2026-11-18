import { describe, expect, it } from "vitest";

import { botLook, castFor, castRole, commonPrefix, displayRole } from "./bot-look";
import { roleColor } from "./trace-layout";

describe("botLook", () => {
  it("takes its colour from roleColor", () => {
    expect(botLook("marrow-reviewer").color).toBe(roleColor("marrow-reviewer"));
  });
});

describe("castFor", () => {
  it.each([
    ["marrow-planner", undefined, "locate"],
    ["explorer", undefined, "locate"],
    ["marrow-test-writer", undefined, "verify"],
    ["marrow-implementer", undefined, "implementer"],
    ["code-monkey", undefined, "implementer"],
    ["builder", undefined, "implementer"],
    ["marrow-reviewer", undefined, "verify"],
    ["critic", undefined, "verify"],
    ["qa", undefined, "verify"],
    ["main", undefined, "deliver"],
    ["root", undefined, "deliver"],
    ["shipper", undefined, "deliver"],
    ["factory", undefined, "deliver"],
    ["discovery", "discovery", "locate"],
    ["deploy-impact", undefined, "verify"],
    ["claude", "deliver", "deliver"],
  ])("%s in stage %s is played by %s", (role, stage, cast) => {
    expect(castFor(role, stage)).toBe(cast);
  });

  it("does not read the root into a word that merely contains run", () => {
    expect(castFor("test-runner")).toBe("verify");
  });

  it("gives unknown roles a stable character, spread across the cast", () => {
    expect(castFor("summarizer")).toBe(castFor("summarizer"));
    const spread = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map((role) => castFor(role)));
    expect(spread.size).toBeGreaterThan(1);
  });
});

describe("castRole", () => {
  it.each([
    ["locate", undefined, "locate"],
    ["architecture", undefined, "locate"],
    ["reproduce", undefined, "implementer"],
    ["implement", undefined, "implementer"],
    ["baseline", undefined, "verify"],
    ["review", undefined, "verify"],
    ["deliver", undefined, "deliver"],
    ["reviewer", "review", "verify"],
  ])("%s in stage %s is played by %s", (role, stage, cast) => {
    expect(castRole(role, stage)).toBe(cast);
  });

  it("lets an agent's own character win over its stage's", () => {
    expect(castRole("implementer", "verify")).toBe("implementer");
  });

  it("knows only the factory's own roles and stages", () => {
    expect(castRole("constructor")).toBeUndefined();
    expect(castRole("prepare", "prepare")).toBeUndefined();
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
