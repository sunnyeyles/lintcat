import { describe, expect, it } from "vitest";

import { relativeTo, summariseInput, touchedFile } from "./tool-summary";

describe("summariseInput", () => {
  it("picks the telling field per tool", () => {
    expect(summariseInput("Bash", { command: "pnpm test\n--run", description: "x" })).toBe("pnpm test");
    expect(summariseInput("Read", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(summariseInput("Grep", { pattern: "TODO", path: "src" })).toBe("TODO in src");
    expect(summariseInput("Agent", { description: "Implement", prompt: "long" })).toBe("Implement");
    expect(summariseInput("TodoWrite", { todos: [{}, {}] })).toBe("2 todos");
  });

  it("falls back to the first string field, and to empty", () => {
    expect(summariseInput("mcp__x__y", { n: 1, query: "hello" })).toBe("hello");
    expect(summariseInput("Bash", null)).toBe("");
  });

  it("caps long summaries", () => {
    expect(summariseInput("Bash", { command: "x".repeat(500) }).length).toBeLessThan(200);
  });
});

describe("touchedFile", () => {
  it("classifies reads and edits", () => {
    expect(touchedFile("Read", { file_path: "a" })).toEqual({ kind: "read", path: "a" });
    expect(touchedFile("Grep", { pattern: "x" })).toBeUndefined();
    expect(touchedFile("Write", { file_path: "b" })).toEqual({ kind: "edited", path: "b" });
    expect(touchedFile("Bash", { command: "cat a" })).toBeUndefined();
  });
});

describe("relativeTo", () => {
  it("strips the cwd only when the path sits inside it", () => {
    expect(relativeTo("/w/repo", "/w/repo/a.ts")).toBe("a.ts");
    expect(relativeTo("/w/repo/", "/w/repo")).toBe(".");
    expect(relativeTo("/w/repo", "/w/repo2/a.ts")).toBe("/w/repo2/a.ts");
    expect(relativeTo(undefined, "/x")).toBe("/x");
  });
});
