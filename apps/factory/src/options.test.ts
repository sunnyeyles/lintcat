import { describe, expect, it } from "vitest";

import { parseArguments, UsageError } from "#src/options";

describe("the factory command line", () => {
  it("shows help with no command, help, or --help anywhere", () => {
    expect(parseArguments([])).toEqual({ kind: "help" });
    expect(parseArguments(["help"])).toEqual({ kind: "help" });
    expect(parseArguments(["status", "--help"])).toEqual({ kind: "help" });
    expect(parseArguments(["version"])).toEqual({ kind: "version" });
  });

  it("reads a new task with its defaults", () => {
    expect(parseArguments(["new", "add a --json flag"])).toEqual({
      kind: "new",
      outcome: "add a --json flag",
      repoPath: undefined,
      profile: undefined,
      pr: false,
      run: true,
    });
  });

  it("reads every new-task option, written either way", () => {
    expect(parseArguments(["new", "--repo=../x", "fix it", "--profile", "bugfix", "--pr", "--no-run"])).toMatchObject({
      outcome: "fix it",
      repoPath: "../x",
      profile: "bugfix",
      pr: true,
      run: false,
    });
  });

  it("refuses a profile that does not exist", () => {
    expect(() => parseArguments(["new", "x", "--profile", "huge"])).toThrow(/--profile must be one of/);
  });

  it("needs an outcome, and only one", () => {
    expect(() => parseArguments(["new"])).toThrow(UsageError);
    expect(() => parseArguments(["new", "a", "b"])).toThrow(/unexpected argument "b"/);
    expect(() => parseArguments(["new", "  "])).toThrow(/empty/);
  });

  it("takes a run id for the run commands", () => {
    for (const kind of ["run", "resume", "cancel", "result"] as const) {
      expect(parseArguments([kind, "r1"])).toEqual({ kind, runId: "r1" });
      expect(() => parseArguments([kind])).toThrow(/needs a run id/);
    }
  });

  it("makes the status id optional", () => {
    expect(parseArguments(["status"])).toEqual({ kind: "status", runId: undefined });
    expect(parseArguments(["status", "r1"])).toEqual({ kind: "status", runId: "r1" });
  });

  it("follows logs with -f or --follow", () => {
    expect(parseArguments(["logs", "r1", "-f"])).toEqual({ kind: "logs", runId: "r1", follow: true });
    expect(parseArguments(["logs", "--follow", "r1"])).toMatchObject({ follow: true });
    expect(parseArguments(["logs", "r1"])).toMatchObject({ follow: false });
  });

  it("reads the worker poll interval and refuses a bad one", () => {
    expect(parseArguments(["worker"])).toEqual({ kind: "worker", pollMs: 2000 });
    expect(parseArguments(["worker", "--poll-ms", "500"])).toEqual({ kind: "worker", pollMs: 500 });
    expect(() => parseArguments(["worker", "--poll-ms", "fast"])).toThrow(UsageError);
  });

  it("refuses an option another command owns, a missing value, and an unknown command", () => {
    expect(() => parseArguments(["status", "--pr"])).toThrow(/unknown option --pr/);
    expect(() => parseArguments(["init", "--repo"])).toThrow(/--repo needs a value/);
    expect(() => parseArguments(["deploy"])).toThrow(/unknown command "deploy"/);
  });
});
