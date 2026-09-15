import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  describeAgent,
  moveAgent,
  pathPatterns,
  toggleAgent,
  toWorkflowYaml,
  toYaml,
  yamlString,
} from "./agent-config";
import { AGENTS, type AgentConfig, type AgentName } from "./data/types";

function config(over: Partial<AgentConfig> = {}): AgentConfig {
  return { ...DEFAULT_CONFIG, paths: { include: [], exclude: [] }, ...over };
}

function unquote(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"') : value;
}

/** Reads back exactly the two shapes toYaml emits, to check the round-trip. */
function parseAgentsYaml(yaml: string): {
  agents: string[];
  pathsByAgent: Record<string, string[]>;
} {
  const agents: string[] = [];
  const pathsByAgent: Record<string, string[]> = {};
  let current: string | null = null;
  for (const raw of yaml.split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    if (raw === "agents:" || raw === "agents: []") continue;
    const bare = /^ {2}- ([^\s:]+)$/.exec(raw);
    if (bare?.[1] !== undefined) {
      current = unquote(bare[1]);
      agents.push(current);
      continue;
    }
    const named = /^ {2}- agent: (.+)$/.exec(raw);
    if (named?.[1] !== undefined) {
      current = unquote(named[1]);
      agents.push(current);
      pathsByAgent[current] = [];
      continue;
    }
    if (raw === "    paths:") continue;
    const pattern = /^ {6}- (.+)$/.exec(raw);
    if (pattern?.[1] !== undefined && current !== null) {
      (pathsByAgent[current] ??= []).push(unquote(pattern[1]));
      continue;
    }
    throw new Error(`unparsed line: ${JSON.stringify(raw)}`);
  }
  return { agents, pathsByAgent };
}

describe("toYaml", () => {
  it("preserves agent order rather than the canonical AGENTS order", () => {
    const agents: AgentName[] = ["docs-drift", "security", "performance"];
    expect(parseAgentsYaml(toYaml(config({ agents }))).agents).toEqual(agents);
    expect(toYaml(config({ agents }))).toBe(
      "agents:\n  - docs-drift\n  - security\n  - performance\n",
    );
  });

  it("round-trips every ordering of the full set", () => {
    const rotations = AGENTS.map((_, i) => [...AGENTS.slice(i), ...AGENTS.slice(0, i)]);
    for (const agents of rotations) {
      expect(parseAgentsYaml(toYaml(config({ agents }))).agents).toEqual(agents);
    }
  });

  it("emits a parseable empty list and says the action fails", () => {
    const yaml = toYaml(config({ agents: [] }));
    expect(yaml).toContain("agents: []");
    expect(yaml).toContain("#");
    expect(parseAgentsYaml(yaml).agents).toEqual([]);
  });

  it("writes bare names when no path gate is set", () => {
    const yaml = toYaml(config({ agents: ["security", "correctness"] }));
    expect(yaml).not.toContain("paths:");
    expect(yaml).not.toContain("agent:");
    expect(parseAgentsYaml(yaml).pathsByAgent).toEqual({});
  });

  it("repeats the gate under every agent, excludes as ! negations", () => {
    const yaml = toYaml(
      config({
        agents: ["security", "docs-drift"],
        paths: { include: ["src/**", "README.md"], exclude: ["**/*.test.ts"] },
      }),
    );
    const parsed = parseAgentsYaml(yaml);
    expect(parsed.agents).toEqual(["security", "docs-drift"]);
    const expected = ["src/**", "README.md", "!**/*.test.ts"];
    expect(parsed.pathsByAgent["security"]).toEqual(expected);
    expect(parsed.pathsByAgent["docs-drift"]).toEqual(expected);
  });

  it("does not double a ! an exclude already carries", () => {
    expect(pathPatterns({ include: ["a/**"], exclude: ["!b/**"] })).toEqual([
      "a/**",
      "!b/**",
    ]);
  });

  it("emits an include-only and an exclude-only gate", () => {
    const only = toYaml(
      config({ agents: ["security"], paths: { include: ["src/**"], exclude: [] } }),
    );
    expect(parseAgentsYaml(only).pathsByAgent["security"]).toEqual(["src/**"]);
    const neg = toYaml(
      config({ agents: ["security"], paths: { include: [], exclude: ["dist/**"] } }),
    );
    expect(parseAgentsYaml(neg).pathsByAgent["security"]).toEqual(["!dist/**"]);
  });

  it("never writes fix or memory-branch into the strict agent file", () => {
    const yaml = toYaml(config({ fix: true, memoryBranch: "pr-review-memory" }));
    expect(yaml).not.toContain("fix");
    expect(yaml).not.toContain("memory-branch");
    expect(yaml.startsWith("agents:")).toBe(true);
  });

  it("ends with exactly one newline", () => {
    expect(toYaml(config())).toMatch(/[^\n]\n$/);
  });
});

describe("yamlString", () => {
  it("quotes glob indicators and leaves plain names bare", () => {
    expect(yamlString("security")).toBe("security");
    expect(yamlString("test-coverage")).toBe("test-coverage");
    expect(yamlString("README.md")).toBe("README.md");
    expect(yamlString("**/*.ts")).toBe('"**/*.ts"');
    expect(yamlString("!dist/**")).toBe('"!dist/**"');
    expect(yamlString("a b")).toBe('"a b"');
  });

  it("quotes words YAML would read as booleans or null", () => {
    for (const word of ["true", "no", "off", "null", "Yes"]) {
      expect(yamlString(word)).toBe(`"${word}"`);
    }
  });
});

describe("toWorkflowYaml", () => {
  it("is empty when both inputs are at their default", () => {
    expect(toWorkflowYaml(config())).toBe("");
    expect(toWorkflowYaml(config({ fix: false, memoryBranch: null }))).toBe("");
  });

  it("treats an empty memory branch as off", () => {
    expect(toWorkflowYaml(config({ memoryBranch: "" }))).toBe("");
  });

  it("emits fix as the quoted string the action compares", () => {
    const yaml = toWorkflowYaml(config({ fix: true }));
    expect(yaml).toContain('fix: "true"');
    expect(yaml).not.toContain("memory-branch");
  });

  it("emits both inputs under one with: block", () => {
    const yaml = toWorkflowYaml(config({ fix: true, memoryBranch: "pr-review-memory" }));
    expect(yaml).toContain("with:");
    expect(yaml).toContain('fix: "true"');
    expect(yaml).toContain("memory-branch: pr-review-memory");
  });

  it("quotes a branch name YAML would misread", () => {
    expect(toWorkflowYaml(config({ memoryBranch: "no" }))).toContain(
      'memory-branch: "no"',
    );
  });
});

describe("moveAgent", () => {
  it("swaps with the neighbour in the given direction", () => {
    const agents: AgentName[] = ["security", "correctness", "performance"];
    expect(moveAgent(agents, 1, -1)).toEqual([
      "correctness",
      "security",
      "performance",
    ]);
    expect(moveAgent(agents, 1, 1)).toEqual([
      "security",
      "performance",
      "correctness",
    ]);
  });

  it("returns the list unchanged at either end or out of range", () => {
    const agents: AgentName[] = ["security", "correctness"];
    expect(moveAgent(agents, 0, -1)).toBe(agents);
    expect(moveAgent(agents, 1, 1)).toBe(agents);
    expect(moveAgent(agents, 9, 1)).toBe(agents);
  });

  it("does not mutate its input", () => {
    const agents: AgentName[] = ["security", "correctness"];
    moveAgent(agents, 0, 1);
    expect(agents).toEqual(["security", "correctness"]);
  });
});

describe("toggleAgent", () => {
  it("removes an agent and re-adds it in AGENTS order", () => {
    const off = toggleAgent([...AGENTS], "performance", false);
    expect(off).not.toContain("performance");
    expect(toggleAgent(off, "performance", true)).toEqual([...AGENTS]);
  });

  it("is a no-op when the agent is already in the wanted state", () => {
    const agents: AgentName[] = ["security"];
    expect(toggleAgent(agents, "security", true)).toBe(agents);
    expect(toggleAgent(agents, "docs-drift", false)).toEqual(["security"]);
  });
});

describe("describeAgent", () => {
  it("gives every shipped agent a non-empty one-line description", () => {
    for (const agent of AGENTS) {
      const line = describeAgent(agent);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain("\n");
    }
  });

  it("uses the README wording", () => {
    expect(describeAgent("security")).toBe(
      "Auth, cross-tenant access, injection, secret leakage, privilege",
    );
    expect(describeAgent("docs-drift")).toBe("Documentation this change made wrong");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("is every agent, both features off, no gate", () => {
    expect(DEFAULT_CONFIG.agents).toEqual([...AGENTS]);
    expect(DEFAULT_CONFIG.fix).toBe(false);
    expect(DEFAULT_CONFIG.memoryBranch).toBeNull();
    expect(toWorkflowYaml(DEFAULT_CONFIG)).toBe("");
  });
});
