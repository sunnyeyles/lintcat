import { describe, expect, it } from "vitest";

import { loadFixture } from "@/lib/run-trace/adapters/fixtures/load";
import { lintcatAdapter } from "@/lib/run-trace/adapters/lintcat";

const AT = "2026-11-12T10:00:00Z";
const ndjson = (...lines: unknown[]) => [{ name: "run.ndjson", text: lines.map((l) => JSON.stringify(l)).join("\n") }];

describe("lintcatAdapter", () => {
  it("detects the run format and nothing else", () => {
    expect(lintcatAdapter.detect(loadFixture("lintcat"))).toBe(0.95);
    expect(lintcatAdapter.detect(loadFixture("claude-code"))).toBe(0);
    expect(lintcatAdapter.detect(loadFixture("openai-agents"))).toBe(0);
  });

  it("builds the tree, steps, usage and outcome", () => {
    const trace = lintcatAdapter.parse(loadFixture("lintcat"));
    expect(trace).toMatchObject({
      sessionId: "nightly-docs-42",
      title: "Refresh API docs",
      outcome: { status: "delivered", url: "https://github.com/example/shop/pull/7" },
    });
    expect(trace.root.status).toBe("done");
    const lead = trace.root.children[0]!;
    const writer = lead.children[0]!;
    expect(writer).toMatchObject({
      role: "writer",
      stage: "write",
      status: "done",
      filesRead: ["src/api.ts"],
      filesEdited: ["docs/api.md"],
    });
    expect(writer.cost?.inputTokens).toBe(14300);
    expect(writer.cost?.usd).toBeCloseTo(0.061);
    const spawn = lead.steps.find((s) => s.kind === "tool" && s.call.name === "spawn");
    expect(spawn?.kind === "tool" && spawn.call).toMatchObject({ childAgentId: "writer", result: "Drafted docs/api.md" });
    const check = writer.steps.find((s) => s.kind === "event");
    expect(check?.kind === "event" && check.event).toMatchObject({ category: "check", status: "error" });
  });

  it("drops invalid lines and breaks parent cycles", () => {
    const { root } = lintcatAdapter.parse(
      ndjson(
        { type: "agent_started", at: AT, agent: "a", parent: "b", role: "a" },
        { type: "agent_started", at: AT, agent: "b", parent: "a", role: "b" },
        { type: "agent_started", at: "not a date", agent: "c", role: "c" },
        { type: "rm -rf", at: AT },
      ),
    );
    expect(root.role).toBe("run");
    expect(root.children.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("leaves an agent with no agent_finished running", () => {
    const { root } = lintcatAdapter.parse(ndjson({ type: "agent_started", at: AT, agent: "solo", role: "worker" }));
    expect(root).toMatchObject({ id: "solo", status: "running" });
  });
});
