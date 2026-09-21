import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { missingInputs, parseInputNames } from "./check-action-inputs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "check-action-inputs.mjs");

const manifest = (inputs) => `name: Example
description: >-
  Something with a colon: in it.

inputs:
${inputs}
runs:
  using: node24
  main: dist/index.mjs
`;

const v2 = manifest(`  api-key:
    description: >-
      Key for: the provider.
    required: false
    default: ""
  # a comment
  agents:
    description: Which agents run.
    default: all

  "agent-config":
    default: .github/pr-review-agents.yml
`);

describe("parseInputNames", () => {
  it("reads only the keys directly under inputs", () => {
    expect(parseInputNames(v2)).toEqual(["api-key", "agents", "agent-config"]);
  });

  it("returns nothing for a manifest without inputs", () => {
    expect(parseInputNames("name: x\nruns:\n  using: node24\n")).toEqual([]);
  });

  it("refuses a flow-style inputs map rather than misreading it", () => {
    expect(() => parseInputNames("inputs: { a: {} }\n")).toThrow(/block mapping/);
  });

  it("reads the real action manifest", () => {
    const names = parseInputNames(
      readFileSync(path.join(here, "..", "apps", "action", "action.yml"), "utf8"),
    );
    expect(names).toContain("api-key");
    expect(names).toContain("dashboard-url");
    expect(names).not.toContain("description");
  });
});

describe("missingInputs", () => {
  it("passes when inputs are only added", () => {
    const next = manifest(`  api-key:\n  agents:\n  agent-config:\n  index:\n`);
    expect(missingInputs(v2, next)).toEqual([]);
  });

  it("reports removed and renamed inputs", () => {
    const next = manifest(`  api-key:\n  agent-set:\n`);
    expect(missingInputs(v2, next)).toEqual(["agents", "agent-config"]);
  });
});

describe("the command line", () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  function run(previous, next) {
    dir = mkdtempSync(path.join(tmpdir(), "action-inputs-"));
    writeFileSync(path.join(dir, "previous.yml"), previous);
    writeFileSync(path.join(dir, "next.yml"), next);
    return spawnSync(
      process.execPath,
      [script, path.join(dir, "previous.yml"), path.join(dir, "next.yml"), "v2"],
      { encoding: "utf8" },
    );
  }

  it("fails with a workflow error annotation naming the lost inputs", () => {
    const result = run(v2, manifest(`  api-key:\n`));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error title=Breaking input change::/);
    expect(result.stdout).toContain("`agents`, `agent-config`");
    expect(result.stdout).toContain("v2");
  });

  it("succeeds when every published input survives", () => {
    const result = run(v2, v2);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("::error");
  });
});
