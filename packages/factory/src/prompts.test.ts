import { cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assetPath } from "#src/assets";
import { loadPrompt, renderMessage, type Role } from "#src/prompts";
import { reviewPrompt, reviewRepairPrompt } from "#src/review";
import { implementPrompt, repairPrompt, reproducePrompt } from "#src/stage-prompts";
import type { TaskContract } from "#src/contract";
import { sampleSpec } from "#src/test-fixtures";

const ROLES: Role[] = ["discovery", "scoper", "implementer", "reviewer"];
const plan = { install: null, source: "file", checks: [{ name: "test", command: "pnpm test" }] } as unknown as Parameters<typeof implementPrompt>[2];
// The prompt builders read only the spec and the base commit.
const contract = { baseSha: "0123456789abcdef0123456789abcdef01234567", spec: sampleSpec } as TaskContract;
const temps: string[] = [];

function copyOfPrompts(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "factory-prompts-"));
  temps.push(dir);
  cpSync(assetPath("agents"), dir, { recursive: true });
  return dir;
}

afterEach(() => {
  delete process.env.FACTORY_PROMPTS_DIR;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("prompts", () => {
  it("versions every role by number and folder content", () => {
    for (const role of ROLES) expect(loadPrompt(role).version).toMatch(new RegExp(`^${role}@\\d+\\+[0-9a-f]{8}$`));
  });

  it("renders every stage message with no slot left unfilled", () => {
    const rendered = [
      reproducePrompt(contract, { files: ["src/a.ts"] }, plan),
      implementPrompt(contract, { located: null, regression: { testFiles: ["a.test.ts"], failing: ["test"] }, baselineFailing: ["lint"], placement: true }, plan),
      repairPrompt([{ name: "test", exitCode: 1, timedOut: true, output: "boom" }], 1, 2),
      reviewPrompt(contract, ["src/a.ts"], "+x"),
      reviewRepairPrompt([{ severity: "blocking", file: "src/a.ts", line: 3, problem: "off by one" }]),
    ];
    for (const text of rendered) expect(text).not.toMatch(/\{\{/);
    expect(rendered[2]).toContain("## test (exit 1, timed out)");
  });

  it("throws on a missing value and on a value with no slot", () => {
    expect(() => renderMessage("discovery", "answer", {})).toThrow(/no value for \[answer\]/);
    expect(() => renderMessage("discovery", "answer", { answer: "a", extra: "b" })).toThrow(/no slot for \[extra\]/);
  });

  it("changes the version when any message file changes, and loads a set from FACTORY_PROMPTS_DIR", () => {
    const base = loadPrompt("discovery").version;
    const dir = copyOfPrompts();
    writeFileSync(path.join(dir, "discovery", "answer.md"), "Reply: {{answer}}\n");
    process.env.FACTORY_PROMPTS_DIR = dir;
    expect(loadPrompt("discovery").version).not.toBe(base);
    expect(renderMessage("discovery", "answer", { answer: "yes" })).toBe("Reply: yes");
  });

  it("refuses an incomplete prompt set", () => {
    const dir = copyOfPrompts();
    unlinkSync(path.join(dir, "scoper", "scope.md"));
    process.env.FACTORY_PROMPTS_DIR = dir;
    expect(() => loadPrompt("scoper")).toThrow(/missing \[scope\.md\]/);
  });
});
