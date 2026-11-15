import { describe, expect, it } from "vitest";

import { sampleRun } from "@/lib/run-trace/__fixtures__/transcripts";
import { claudeCodeAdapter } from "@/lib/run-trace/adapters/claude-code";
import { loadFixture } from "@/lib/run-trace/adapters/fixtures/load";
import { parseRun } from "@/lib/run-trace/parse-run";

describe("claudeCodeAdapter", () => {
  it("detects a session transcript and ignores other JSON", () => {
    expect(claudeCodeAdapter.detect(loadFixture("claude-code"))).toBeGreaterThan(0.8);
    expect(claudeCodeAdapter.detect(loadFixture("lintcat"))).toBe(0);
    expect(claudeCodeAdapter.detect(loadFixture("lintcat-factory"))).toBe(0);
  });

  it("parses exactly as parseRun does", () => {
    expect(claudeCodeAdapter.parse(sampleRun())).toEqual(parseRun(sampleRun()));
  });

  it("nests the subagent under the call that spawned it", () => {
    const trace = claudeCodeAdapter.parse(loadFixture("claude-code"));
    expect(trace.title).toBe("Add discount codes to checkout");
    expect(trace.root.children.map((c) => [c.id, c.role])).toEqual([["impl1", "implementer"]]);
    expect(trace.root.children[0]?.filesEdited).toEqual(["src/checkout/form.tsx"]);
  });
});
