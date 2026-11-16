import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assetPath } from "#src/engine/assets";
import type { TaskContract } from "#src/engine/contract";
import { loadPrompt, MESSAGES, renderMessage } from "#src/engine/prompts";
import { reviewPrompt, reviewRepairPrompt } from "#src/engine/review";
import { implementPrompt, repairPrompt, reproducePrompt } from "#src/engine/stage-prompts";
import { sampleSpec } from "#src/engine/test-fixtures";

const roles = Object.keys(MESSAGES) as (keyof typeof MESSAGES)[];

const contract = {
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  spec: sampleSpec,
} as TaskContract;
const plan = { install: null, checks: [{ name: "test", command: "pnpm test" }], source: "detected" as const };

async function copySet(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "factory-prompts-"));
  await cp(assetPath("agents"), dir, { recursive: true });
  return dir;
}

afterEach(() => {
  delete process.env.FACTORY_PROMPTS_DIR;
});

describe("prompt sets", () => {
  it.each(roles)("loads %s with a hashed version", (role) => {
    expect(loadPrompt(role).version).toMatch(new RegExp(`^${role}@\\d+\\+[0-9a-f]{8}$`));
  });

  it("renders every prompt builder with no slot left", () => {
    const rendered = [
      reproducePrompt(contract, { files: ["src/cli.ts"] }, plan),
      implementPrompt(contract, { located: {}, regression: { testFiles: ["a.test.ts"], failing: ["test"] }, baselineFailing: ["lint"], placement: true }, plan),
      repairPrompt([{ name: "test", exitCode: 1, timedOut: true, output: "boom" }], 1, 2),
      reviewPrompt(contract, ["src/cli.ts"], "x".repeat(90_000)),
      reviewRepairPrompt([{ severity: "blocking", file: "src/cli.ts", line: 3, problem: "wrong" }]),
    ];
    for (const text of rendered) expect(text).not.toContain("{{");
    expect(rendered[3]).toContain("diff truncated");
  });

  it("throws on a slot with no value and on a value with no slot", () => {
    expect(() => renderMessage("discovery", "answer", {})).toThrow(/no value for \[answer\]/);
    expect(() => renderMessage("discovery", "answer", { answer: "a", extra: "b" })).toThrow(/no slot for \[extra\]/);
  });

  it("never expands a slot inside a value", () => {
    expect(renderMessage("discovery", "answer", { answer: "{{answer}}" })).toBe("Answer: {{answer}}");
  });

  it("loads an override set, versioned by every file in the role's folder", async () => {
    const dir = await copySet();
    try {
      const original = loadPrompt("reviewer").version;
      await appendFile(path.join(dir, "reviewer", "diff-truncated.md"), "edited\n");
      process.env.FACTORY_PROMPTS_DIR = dir;
      expect(loadPrompt("reviewer").version).not.toBe(original);
      expect(renderMessage("reviewer", "diff-truncated", { diff: "d" })).toContain("edited");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws on an incomplete or padded set", async () => {
    const dir = await copySet();
    try {
      await rm(path.join(dir, "scoper", "scope.md"));
      await appendFile(path.join(dir, "reviewer", "stray.md"), "x");
      process.env.FACTORY_PROMPTS_DIR = dir;
      expect(() => loadPrompt("scoper")).toThrow(/missing \[scope\.md\]/);
      expect(() => loadPrompt("reviewer")).toThrow(/unexpected \[stray\.md\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
