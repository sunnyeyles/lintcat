import { readFileSync } from "node:fs";
import path from "node:path";

import {
  finalFindingsJson,
  makeFinding,
  makeHangingModel,
  makeModel,
  message,
  textBlock,
} from "@pr-review/ai/agent-test-support";
import { createCapturingLogger } from "@pr-review/logging";
import { openLocalMemoryStore, type McpEnvironment } from "@pr-review/mcp/local-review";
import { createTestRepo, type TestRepo } from "@pr-review/mcp/test-repo";
import { addSuppression, readMemory, writeMemory } from "@pr-review/reviewer";
import { localReviewReportSchema, type ReviewFinding } from "@pr-review/schemas";
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

async function run(
  argv: string[],
  overrides: Partial<McpEnvironment> = {},
  signal?: AbortSignal,
  stdin?: string,
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliEnvironment = {
    environment: environment(overrides),
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    commandLine: "node /opt/pr-review/start.mjs",
    signal,
    stdin: async () => stdin ?? "",
  };
  return { code: await runCli(argv, deps), out: out.join("\n"), err: err.join("\n") };
}

const admin = makeFinding("naming", {
  file: "src/sessions.ts",
  line: 3,
  title: "Admin is always on",
  explanation: "The flag ships enabled.",
});

// The index CI builds checks evidence, so it must cite lines the fixture has.
const evidenced = { ...admin, evidence: [{ file: "src/api.ts", line: 1 }, { file: "package.json", line: 1 }] };

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
    const elsewhere = makeFinding("naming", { file: "src/untouched.ts", line: 2 });

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

describe("the CI profile", () => {
  async function suppressAdmin() {
    const store = await openLocalMemoryStore(repo.root);
    const memory = await readMemory(store, createCapturingLogger().logger);
    await writeMemory(store, addSuppression(memory, admin, new Date()));
  }

  it("hides a locally suppressed finding by default", async () => {
    await suppressAdmin();

    const { out } = await run(["--base", "main", "--no-index"], {
      createLanguageModel: () => scriptedModel([admin]),
    });

    expect(out).not.toContain("Admin is always on");
  });

  it("reports a finding the local memory suppresses, as CI would", async () => {
    await suppressAdmin();

    const { code, out } = await run(["--base", "main", "--profile", "ci"], {
      createLanguageModel: () => scriptedModel([evidenced]),
    });

    expect(out).toContain("Admin is always on");
    expect(code).toBe(1);
  });

  it("names the model it reviews with", async () => {
    const { err } = await run(["--base", "main", "--no-index"], {
      createLanguageModel: () => scriptedModel([]),
    });

    expect(err).toContain("Model: openai gpt-5.6-luna");
  });

  it("warns when the model is not the one CI defaults to", async () => {
    const { err } = await run(["--base", "main", "--profile", "ci"], {
      env: { OPENAI_API_KEY: "sk-test", PR_REVIEW_MODEL: "gpt-5.6-luna-mini" },
      createLanguageModel: () => scriptedModel([]),
    });

    expect(err).toContain("Model: openai gpt-5.6-luna-mini");
    expect(err).toContain("CI reviews with gpt-5.6-luna");
  });

  it("refuses to skip the index CI always builds", async () => {
    const { code, err } = await run(["--profile", "ci", "--no-index"]);

    expect(err).toContain("--no-index cannot be used with --profile ci");
    expect(code).toBe(2);
  });
});

describe("the JSON report", () => {
  function report(out: string) {
    return localReviewReportSchema.parse(JSON.parse(out));
  }

  it("prints one document the report schema accepts, and keeps progress on stderr", async () => {
    const { code, out, err } = await run(["--base", "main", "--no-index", "--format", "json"], {
      createLanguageModel: () => scriptedModel([admin]),
    });

    const parsed = report(out);
    expect(parsed.findings.map((finding) => finding.title)).toEqual(["Admin is always on"]);
    expect(parsed.findings[0]!.id).toMatch(/^[0-9a-f]{12}$/);
    expect(parsed.blocking).toBe(1);
    expect(parsed.summary).toContain("## ");
    expect(parsed.model).toEqual({ provider: "openai", modelId: "gpt-5.6-luna" });
    expect(err).toContain("Reviewing 1 changed file(s)");
    expect(code).toBe(1);
  });

  it("gives a finding the same id on every run over the same tree", async () => {
    const first = await run(["--base", "main", "--no-index", "--format", "json"], {
      createLanguageModel: () => scriptedModel([admin]),
    });
    const second = await run(["--base", "main", "--no-index", "--format", "json"], {
      createLanguageModel: () => scriptedModel([{ ...admin, explanation: "Worded another way." }]),
    });

    expect(report(second.out).findings[0]!.id).toBe(report(first.out).findings[0]!.id);
  });

  it("carries a verified patch and drops one that does not match the file", async () => {
    const fixable = {
      ...admin,
      patch: { startLine: 3, endLine: 3, expected: "export const admin = true;", replacement: "export const admin = false;" },
    };
    const stale = makeFinding("naming", {
      file: "src/sessions.ts",
      line: 2,
      title: "Sessions never expire",
      patch: { startLine: 2, endLine: 2, expected: "not what the file says", replacement: "x" },
    });

    const { out } = await run(["--base", "main", "--no-index", "--format", "json"], {
      createLanguageModel: () => scriptedModel([fixable, stale]),
    });

    const byTitle = new Map(report(out).findings.map((finding) => [finding.title, finding]));
    expect(byTitle.get("Admin is always on")?.patch?.replacement).toBe("export const admin = false;");
    expect(byTitle.get("Sessions never expire")?.patch).toBeUndefined();
  });

  it("answers in JSON when there is nothing to review", async () => {
    repo.commit("admin");
    repo.git("checkout", "-q", "main");

    const { code, out } = await run(["--base", "main", "--format", "json"]);

    expect(report(out).findings).toEqual([]);
    expect(code).toBe(0);
  });
});

describe("reusing an earlier review", () => {
  const review = ["--base", "main", "--no-index", "--format", "json"];

  function counted(findings: readonly ReviewFinding[] = [admin]) {
    return vi.fn(() => scriptedModel(findings));
  }

  it("answers a second run over the same tree without calling a model", async () => {
    await run(review, { createLanguageModel: counted() });
    const createLanguageModel = counted();

    const { code, out, err } = await run(review, { createLanguageModel });

    expect(createLanguageModel).not.toHaveBeenCalled();
    const parsed = localReviewReportSchema.parse(JSON.parse(out));
    expect(parsed.cached).toBe(true);
    expect(parsed.findings.map((finding) => finding.title)).toEqual(["Admin is always on"]);
    expect(err).toContain("from the cache");
    expect(code).toBe(1);
  });

  it("reviews again once a file changes", async () => {
    await run(review, { createLanguageModel: counted() });
    repo.write("src/api.ts", 'import { createSession } from "./sessions";\nexport const x = 1;\n');
    const createLanguageModel = counted();

    await run(review, { createLanguageModel });

    expect(createLanguageModel).toHaveBeenCalled();
  });

  it("reviews again under another model", async () => {
    await run(review, { createLanguageModel: counted() });
    const createLanguageModel = counted();

    await run(review, {
      env: { OPENAI_API_KEY: "sk-test", PR_REVIEW_MODEL: "gpt-5.6-luna-mini" },
      createLanguageModel,
    });

    expect(createLanguageModel).toHaveBeenCalled();
  });

  it("reviews again when asked not to use the cache", async () => {
    await run(review, { createLanguageModel: counted() });
    const createLanguageModel = counted();

    await run([...review, "--no-cache"], { createLanguageModel });

    expect(createLanguageModel).toHaveBeenCalled();
  });

  it("judges a cached report against the threshold asked for now", async () => {
    await run(review, { createLanguageModel: counted() });

    const { code } = await run([...review, "--fail-on", "off"], { createLanguageModel: counted() });

    expect(code).toBe(0);
  });

  it("never caches a cancelled review", async () => {
    const { model, firstCall } = makeHangingModel();
    const controller = new AbortController();
    const pending = run(review, { createLanguageModel: () => model }, controller.signal);
    await firstCall;
    controller.abort();
    await pending;
    const createLanguageModel = counted();

    await run(review, { createLanguageModel });

    expect(createLanguageModel).toHaveBeenCalled();
  });
});

describe("suppressing a finding", () => {
  const review = ["--base", "main", "--no-index", "--format", "json"];

  it("stops a later review raising the finding it names", async () => {
    const first = await run(review, { createLanguageModel: () => scriptedModel([admin]) });
    const [finding] = localReviewReportSchema.parse(JSON.parse(first.out)).findings;

    const suppressed = await run(["suppress", finding!.id, "--reason", "Admin is meant to be on here"]);
    const later = await run(review, { createLanguageModel: () => scriptedModel([admin]) });

    expect(suppressed.code).toBe(0);
    expect(suppressed.out).toContain("Suppressed");
    const report = localReviewReportSchema.parse(JSON.parse(later.out));
    expect(report.findings).toEqual([]);
    expect(report.suppressed).toBe(1);
  });

  it("fails clearly on an id the last review did not report", async () => {
    await run(review, { createLanguageModel: () => scriptedModel([admin]) });

    const { code, err } = await run(["suppress", "0123456789ab"]);

    expect(err).toContain('no finding "0123456789ab" in the last review');
    expect(code).toBe(2);
  });

  it("needs an id", async () => {
    const { code, err } = await run(["suppress"]);

    expect(err).toContain("suppress needs a finding id");
    expect(code).toBe(2);
  });

  it("is documented in the help", async () => {
    const { out } = await run(["--help"]);

    expect(out).toContain("pr-review suppress <id>");
  });
});

describe("the Claude Code push gate", () => {
  function hookInput(command: string): string {
    return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: repo.root, tool_input: { command } });
  }

  function gate(command: string, overrides: Partial<McpEnvironment> = {}) {
    return run(["claude-hook"], overrides, undefined, hookInput(command));
  }

  it("lets any other command through without reviewing", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([evidenced]));

    const { code } = await gate("git status && pnpm test", { createLanguageModel });

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("blocks a push on a high finding and hands Claude the finding", async () => {
    const { code, err } = await gate("git push -u origin feature", {
      createLanguageModel: () => scriptedModel([evidenced]),
    });

    expect(err).toContain("src/sessions.ts:3");
    expect(err).toContain("Admin is always on");
    expect(err).toContain("node /opt/pr-review/start.mjs suppress");
    expect(code).toBe(2);
  });

  it("gates opening a pull request too", async () => {
    const { code } = await gate('gh pr create --title "x" --body "y"', {
      createLanguageModel: () => scriptedModel([evidenced]),
    });

    expect(code).toBe(2);
  });

  it("lets a push through when nothing blocks", async () => {
    const { code } = await gate("git push", {
      createLanguageModel: () => scriptedModel([{ ...evidenced, severity: "low" }]),
    });

    expect(code).toBe(0);
  });

  it("is bypassed by PR_REVIEW_SKIP", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([evidenced]));

    const { code } = await gate("git push", {
      env: { OPENAI_API_KEY: "sk-test", PR_REVIEW_SKIP: "1" },
      createLanguageModel,
    });

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("answers a retry on the same tree without calling a model", async () => {
    await gate("git push", { createLanguageModel: () => scriptedModel([evidenced]) });
    const createLanguageModel = vi.fn(() => scriptedModel([evidenced]));

    const { code } = await gate("git push", { createLanguageModel });

    expect(createLanguageModel).not.toHaveBeenCalled();
    expect(code).toBe(2);
  });

  it("does not block when the review cannot run, and says why", async () => {
    const { code, err } = await gate("git push", { env: {} });

    expect(err).toContain("No model API key is set");
    expect(err).toContain("not reviewed");
    expect(code).toBe(0);
  });
});

describe("cancelling a review", () => {
  it("aborts the in-flight model calls and prints no verdict", async () => {
    const { model, firstCall } = makeHangingModel();
    const controller = new AbortController();

    const pending = run(["--base", "main", "--no-index"], { createLanguageModel: () => model }, controller.signal);
    await firstCall;
    controller.abort();
    const { code, out, err } = await pending;

    expect(model.doGenerateCalls.length).toBeGreaterThan(0);
    for (const call of model.doGenerateCalls) expect(call.abortSignal?.aborted).toBe(true);
    expect(err).toContain("review cancelled");
    expect(out).not.toContain("No findings");
    expect(out).not.toContain("Blocked");
    expect(code).toBe(3);
  });

  it("prints no finding when cancelled before the agents start", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([admin]));
    const controller = new AbortController();
    controller.abort();

    const { code, out } = await run(["--base", "main", "--no-index"], { createLanguageModel }, controller.signal);

    expect(out).not.toContain("Admin is always on");
    expect(code).toBe(3);
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
