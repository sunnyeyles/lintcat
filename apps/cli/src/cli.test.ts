import { readFileSync } from "node:fs";
import path from "node:path";

import {
  finalFindingsJson,
  makeFinding,
  makeModel,
  message,
  textBlock,
} from "@pr-review/ai/agent-test-support";
import { createCapturingLogger } from "@pr-review/logging";
import type { McpEnvironment } from "@pr-review/mcp/local-review";
import { createTestRepo, type TestRepo } from "@pr-review/mcp/test-repo";
import type { ReviewFinding } from "@pr-review/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliEnvironment } from "#src/cli";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({
    "package.json": '{ "name": "fixture" }\n',
    "src/sessions.ts": "export const sessions = [];\nexport function createSession() {}\n",
    "src/api.ts": 'import { createSession } from "./sessions";\n',
  });
  repo.git("checkout", "-q", "-b", "feature");
  repo.write(
    "src/sessions.ts",
    "export const sessions = [];\nexport function createSession() {}\nexport const admin = true;\n",
  );
});

afterEach(() => repo.remove());

function scriptedModel(findings: readonly ReviewFinding[]) {
  return makeModel([message([textBlock(finalFindingsJson([...findings]))], "end_turn")]).model;
}

function environment(overrides: Partial<McpEnvironment> = {}): McpEnvironment {
  return {
    env: { OPENAI_API_KEY: "sk-test" },
    cwd: repo.root,
    logger: createCapturingLogger().logger,
    createLanguageModel: () => {
      throw new Error("no model scripted");
    },
    createTokenClient: () => {
      throw new Error("no GitHub client scripted");
    },
    gh: async () => {
      throw new Error("no gh scripted");
    },
    database: () => {
      throw new Error("no database scripted");
    },
    ...overrides,
  };
}

interface Run {
  code: number;
  out: string;
  err: string;
}

async function run(argv: string[], overrides: Partial<McpEnvironment> = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliEnvironment = {
    environment: environment(overrides),
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    commandLine: "node /opt/pr-review/start.mjs",
  };
  return { code: await runCli(argv, deps), out: out.join("\n"), err: err.join("\n") };
}

const admin = makeFinding("general", {
  file: "src/sessions.ts",
  line: 3,
  title: "Admin is always on",
  explanation: "The flag ships enabled.",
});

describe("reviewing a working tree", () => {
  it("prints each finding with its location and blocks on a high one", async () => {
    const { code, out } = await run(["review", "--base", "main", "--no-index"], {
      createLanguageModel: () => scriptedModel([admin]),
    });

    expect(out).toContain("HIGH");
    expect(out).toContain("src/sessions.ts:3");
    expect(out).toContain("Admin is always on");
    expect(out).toContain("Blocked: 1 finding(s) at or above high.");
    expect(code).toBe(1);
  });

  it("passes when every finding sits below the threshold", async () => {
    const { code, out } = await run(["--base", "main", "--no-index"], {
      createLanguageModel: () => scriptedModel([{ ...admin, severity: "medium" }]),
    });

    expect(out).toContain("1 finding(s): 1 medium.");
    expect(out).not.toContain("Blocked");
    expect(code).toBe(0);
  });

  it("reports without failing when --fail-on is off", async () => {
    const { code, out } = await run(["--base", "main", "--no-index", "--fail-on", "off"], {
      createLanguageModel: () => scriptedModel([admin]),
    });

    expect(out).toContain("Admin is always on");
    expect(code).toBe(0);
  });

  it("fails on a medium finding when asked to", async () => {
    const { code } = await run(["--base", "main", "--no-index", "--fail-on=medium"], {
      createLanguageModel: () => scriptedModel([{ ...admin, severity: "medium" }]),
    });

    expect(code).toBe(1);
  });

  it("prints nothing the pull-request path would have dropped", async () => {
    const elsewhere = makeFinding("general", { file: "src/untouched.ts", line: 2 });

    const { code, out } = await run(["--base", "main", "--no-index"], {
      createLanguageModel: () => scriptedModel([elsewhere]),
    });

    expect(out).not.toContain("src/untouched.ts");
    expect(out).toContain("No findings.");
    expect(code).toBe(0);
  });

  it("says so, and calls no model, when there is nothing to review", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([]));
    repo.commit("admin");
    repo.git("checkout", "-q", "main");

    const { code, out } = await run(["--base", "main"], { createLanguageModel });

    expect(out).toContain("Nothing to review");
    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("names the missing key before doing any work", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([]));

    const { code, err } = await run(["--base", "main"], { env: {}, createLanguageModel });

    expect(err).toContain("No model API key is set");
    expect(err).toContain("ANTHROPIC_API_KEY");
    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(code).toBe(2);
  });

  it("reports a bad ref as an error, not as a clean review", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([]));

    const { code, err } = await run(["--range", "main..nope"], { createLanguageModel });

    expect(err).toContain('unknown commit "nope"');
    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(code).toBe(2);
  });

  it("reviews only the staged changes when asked", async () => {
    repo.git("add", "src/sessions.ts");
    repo.write("src/api.ts", "export const unstaged = 1;\n");
    const { code, err } = await run(["--scope", "staged", "--no-index"], {
      createLanguageModel: () => scriptedModel([]),
    });

    expect(err).toContain("Reviewing 1 changed file(s)");
    expect(err).toContain("the staged changes");
    expect(code).toBe(0);
  });
});

describe("the command line itself", () => {
  it("prints the usage and fails on an unknown option", async () => {
    const { code, err } = await run(["--publish"]);

    expect(err).toContain("unknown option --publish");
    expect(err).toContain("Usage:");
    expect(code).toBe(2);
  });

  it("documents the bypass in its help", async () => {
    const { code, out } = await run(["--help"]);

    expect(out).toContain("PR_REVIEW_SKIP=1 git push");
    expect(code).toBe(0);
  });
});

describe("installing the hook", () => {
  it("writes a hook that re-runs the command that installed it", async () => {
    const { code, out } = await run(["install-hook"]);

    const hook = readFileSync(path.join(repo.root, ".git", "hooks", "pre-push"), "utf8");
    expect(hook).toContain("node /opt/pr-review/start.mjs review --fail-on high");
    expect(out).toContain("Installed the pre-push hook");
    expect(code).toBe(0);
  });

  it("takes the command and the severity from the caller", async () => {
    await run(["install-hook", "--command", "pnpm pr-review", "--fail-on", "medium"]);

    const hook = readFileSync(path.join(repo.root, ".git", "hooks", "pre-push"), "utf8");
    expect(hook).toContain("pnpm pr-review review --fail-on medium");
  });
});
