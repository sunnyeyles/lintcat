import { describe, expect, it } from "vitest";

import { parseArguments, UsageError } from "#src/options";

describe("the command line", () => {
  it("reviews the working tree when no command is named", () => {
    expect(parseArguments([])).toMatchObject({
      kind: "review",
      scope: { kind: "working-tree" },
      failOn: "high",
      index: true,
    });
  });

  it("reads a flag written with a space or an equals sign", () => {
    expect(parseArguments(["review", "--base", "origin/main", "--fail-on=low"])).toMatchObject({
      base: "origin/main",
      failOn: "low",
    });
  });

  it("takes a range as the scope it implies", () => {
    expect(parseArguments(["--range", "HEAD~3..HEAD"])).toMatchObject({
      scope: { kind: "range", range: "HEAD~3..HEAD" },
    });
  });

  it("refuses a range handed to a scope that cannot take one", () => {
    expect(() => parseArguments(["--scope", "staged", "--range", "a..b"])).toThrow(
      /drop one of them/,
    );
  });

  it("refuses a severity that is not one of the four", () => {
    expect(() => parseArguments(["--fail-on", "critical"])).toThrow(UsageError);
  });

  it("refuses an unknown option rather than ignoring it", () => {
    expect(() => parseArguments(["review", "--publish"])).toThrow(/unknown option --publish/);
  });

  it("names --agents as removed rather than unknown", () => {
    expect(() => parseArguments(["--agents=security"])).toThrow(/--agents was removed in v3/);
    expect(() => parseArguments(["install-hook", "--agents", "x"])).toThrow(/removed in v3/);
  });

  it("refuses an option the other command owns", () => {
    expect(() => parseArguments(["install-hook", "--no-index"])).toThrow(
      /unknown option --no-index/,
    );
  });

  it("turns the index off", () => {
    expect(parseArguments(["--no-index"])).toMatchObject({ index: false });
  });

  it("reads the hook installation and its defaults", () => {
    expect(parseArguments(["install-hook"])).toEqual({
      kind: "install-hook",
      repoPath: undefined,
      failOn: "high",
      command: undefined,
      force: false,
    });
  });

  it("answers --help and --version before anything else", () => {
    expect(parseArguments(["review", "--help"])).toEqual({ kind: "help" });
    expect(parseArguments(["--version"])).toEqual({ kind: "version" });
  });

  it("names an unknown command", () => {
    expect(() => parseArguments(["publish"])).toThrow(/unknown command "publish"/);
  });
});
