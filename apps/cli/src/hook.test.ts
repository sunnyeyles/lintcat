import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createTestRepo, type TestRepo } from "@pr-review/mcp/test-repo";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BYPASS_ENV, hookScript, installPrePushHook } from "#src/hook";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({ "src/sessions.ts": "export const sessions = [];\n" });
});

afterEach(() => repo.remove());

const install = (overrides: Partial<Parameters<typeof installPrePushHook>[0]> = {}) =>
  installPrePushHook({
    repoPath: repo.root,
    command: "node /opt/pr-review/start.mjs",
    failOn: "high",
    force: false,
    ...overrides,
  });

describe("the installed pre-push hook", () => {
  it("writes an executable hook that runs the review", async () => {
    const { path: file, replaced } = await install();

    expect(replaced).toBe(false);
    expect(file).toBe(path.join(repo.root, ".git", "hooks", "pre-push"));
    const script = readFileSync(file, "utf8");
    expect(script).toContain("node /opt/pr-review/start.mjs review --fail-on high");
    expect(statSync(file).mode & 0o111).not.toBe(0);
  });

  it("honours core.hooksPath", async () => {
    repo.git("config", "core.hooksPath", ".githooks");

    const { path: file } = await install();

    expect(file).toBe(path.join(repo.root, ".githooks", "pre-push"));
  });

  it("upgrades a hook it wrote earlier without being forced", async () => {
    await install();

    const { replaced, path: file } = await install({ failOn: "medium" });

    expect(replaced).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("--fail-on medium");
  });

  it("refuses to overwrite a hook somebody else wrote", async () => {
    const file = path.join(repo.root, ".git", "hooks", "pre-push");
    writeFileSync(file, "#!/bin/sh\necho mine\n");

    await expect(install()).rejects.toThrow(/--force to replace it/);
    expect(readFileSync(file, "utf8")).toContain("echo mine");
  });

  it("replaces another hook when forced", async () => {
    const file = path.join(repo.root, ".git", "hooks", "pre-push");
    writeFileSync(file, "#!/bin/sh\necho mine\n");

    await install({ force: true });

    expect(readFileSync(file, "utf8")).not.toContain("echo mine");
  });
});

describe("a push that runs the hook", () => {
  /** `false` and `true` stand in for the review, so no model or network is needed. */
  function pushTo(remote: string, env: Record<string, string> = {}) {
    const push = spawnSync("git", ["push", remote, "HEAD:refs/heads/pushed"], {
      cwd: repo.root,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { status: push.status, output: `${push.stdout}${push.stderr}` };
  }

  function pushedSha(remote: string): string {
    return execFileSync("git", ["rev-parse", "--verify", "refs/heads/pushed"], {
      cwd: remote,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  function remoteRepository(): string {
    const remote = path.join(repo.root, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote], { encoding: "utf8" });
    return remote;
  }

  it("blocks the push, and says how to bypass, when the review fails", async () => {
    const remote = remoteRepository();
    await install({ command: "false" });

    const { status, output } = pushTo(remote);

    expect(status).not.toBe(0);
    expect(output).toContain("push blocked");
    expect(output).not.toContain("cancelled");
    expect(output).toContain(`${BYPASS_ENV}=1 git push`);
    expect(() => pushedSha(remote)).toThrow();
  });

  it("refuses the push, and says it was cancelled, when the review is cancelled", async () => {
    const remote = remoteRepository();
    await install({ command: "sh -c 'exit 3'" });

    const { status, output } = pushTo(remote);

    expect(status).not.toBe(0);
    expect(output).toContain("review cancelled");
    expect(output).not.toContain("push blocked");
    expect(() => pushedSha(remote)).toThrow();
  });

  it("reports a review killed by an interrupt as cancelled", async () => {
    const remote = remoteRepository();
    await install({ command: "sh -c 'kill -INT $$'" });

    const { status, output } = pushTo(remote);

    expect(status).not.toBe(0);
    expect(output).toContain("review cancelled");
    expect(() => pushedSha(remote)).toThrow();
  });

  it("lets the push through when the review reports nothing", async () => {
    const remote = remoteRepository();
    await install({ command: "true" });

    expect(pushTo(remote).status).toBe(0);

    expect(pushedSha(remote)).toHaveLength(40);
  });

  it("skips the review entirely when the bypass is set", async () => {
    const remote = remoteRepository();
    await install({ command: "false" });

    const { status, output } = pushTo(remote, { [BYPASS_ENV]: "1" });

    expect(status).toBe(0);
    expect(output).toContain("review skipped");
    expect(pushedSha(remote)).toHaveLength(40);
  });
});

describe("the hook script", () => {
  it("exits early, without reviewing, when the bypass is set", () => {
    const script = hookScript("pr-review", "high");

    expect(script).toMatch(new RegExp(`if \\[ -n "\\$\\{${BYPASS_ENV}:-\\}" \\]`));
    expect(script.indexOf("exit 0")).toBeLessThan(script.indexOf("pr-review review"));
  });
});
