import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TaskContract } from "#src/contract";
import {
  appendEventLine,
  readTaskMarkdown,
  renderTaskMarkdown,
  runDir,
  type TaskView,
  writeArtifact,
  writeRunFiles,
} from "#src/run-files";

const contract: TaskContract = {
  contractVersion: 1,
  taskId: "task-1",
  repoPath: "/repo",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  baseBranch: "main",
  profile: "bugfix",
  routing: { reason: "small fix", overridden: false },
  spec: {
    title: "Fix login redirect",
    objective: "Users land on the dashboard after login.",
    category: "bugfix",
    requirements: ["Redirect to /dashboard"],
    nonGoals: [],
    constraints: ["No new dependencies"],
    acceptanceCriteria: [{ id: "AC1", text: "Login redirects to /dashboard", verification: "automated" }],
    plan: ["Find the redirect", "Fix it"],
    architectureDecisions: ["Reuse the existing router"],
    repositoryFindings: [],
    assumptions: ["Session cookie is set first"],
    estimatedFiles: 1,
    risk: "low",
    touchesSecurityOrData: false,
  },
  permittedOperations: { push: false, openPullRequest: false, networkDuringSetup: false },
  budgets: { maxAgentTurns: 10, maxRepairPasses: 1, wallClockMinutes: 30, commandTimeoutSeconds: 120 },
  approval: { state: "approved" },
  implementationDecisions: [{ at: "2026-11-11T00:00:00.000Z", stage: "implement", decision: "Patch the guard" }],
};

const view = (overrides: Partial<TaskView> = {}): TaskView => ({
  runId: "run-1",
  status: "running",
  stage: "implement",
  profile: null,
  contract,
  progress: [],
  verification: [],
  deviations: [],
  blockers: [],
  outcome: null,
  ...overrides,
});

describe("renderTaskMarkdown", () => {
  it("renders populated sections in order and omits empty ones", () => {
    const md = renderTaskMarkdown(
      view({
        progress: [{ stage: "discover", status: "done" }],
        verification: [{ name: "test", command: "pnpm test | tee", exitCode: 0, passed: true, durationMs: 1500 }],
      }),
    );
    const headings = md.split("\n").filter((l) => l.startsWith("#"));
    expect(headings).toEqual([
      "# Fix login redirect",
      "## Objective",
      "## Requirements",
      "## Acceptance criteria",
      "## Constraints",
      "## Architecture & reuse decisions",
      "## Implementation checklist",
      "## Progress",
      "## Assumptions & deviations",
      "## Verification evidence",
    ]);
    expect(md).toContain("- **Base SHA:** `0123456` (main)");
    expect(md).toContain("- **Profile:** bugfix");
    expect(md).toContain("- [ ] AC1 — Login redirects to /dashboard (automated)");
    expect(md).toContain("- Patch the guard _(implement, 2026-11-11T00:00:00.000Z)_");
    expect(md).toContain("| test | `pnpm test \\| tee` | 0 | pass | 1.5 s |");
    expect(renderTaskMarkdown(view())).toBe(renderTaskMarkdown(view()));
  });

  it("checks criteria and shows blockers, outcome and branch when delivered", () => {
    const md = renderTaskMarkdown(
      view({
        status: "delivered",
        blockers: ["CI is red upstream"],
        deviations: ["Touched a second file"],
        outcome: { summary: "Fixed.", branch: "factory/fix-login", pullRequestUrl: "https://example.com/pr/1" },
      }),
    );
    expect(md).toContain("- [x] AC1");
    expect(md).toContain("## Blockers\n\n- CI is red upstream");
    expect(md).toContain("- **Deviation:** Touched a second file");
    expect(md).toContain("- **Branch:** `factory/fix-login`");
    expect(md).toMatch(/## Outcome\n\nFixed\.\n\n- Branch: `factory\/fix-login`\n- Pull request: https:\/\/example\.com\/pr\/1\n$/);
  });
});

describe("run files", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "factory-run-files-"));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("writes task.md and state.json atomically and detects hand edits", async () => {
    expect(await readTaskMarkdown(repo, "run-1")).toBeNull();
    expect(await writeRunFiles(repo, "run-1", { view: view(), state: { status: "running" } })).toEqual({
      conflict: false,
    });
    const dir = runDir(repo, "run-1");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(join(dir, "artifacts"))).toBe(true);
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(state).toMatchObject({ status: "running", taskMdHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

    expect(await writeRunFiles(repo, "run-1", { view: view({ stage: "verify" }), state: {} })).toEqual({
      conflict: false,
    });

    const edited = `${await readTaskMarkdown(repo, "run-1")}\nMy note\n`;
    writeFileSync(join(dir, "task.md"), edited);
    expect(await writeRunFiles(repo, "run-1", { view: view(), state: {} })).toEqual({ conflict: true });
    expect(readFileSync(join(dir, "task.user-edit.md"), "utf8")).toBe(edited);
    expect(await readTaskMarkdown(repo, "run-1")).toBe(renderTaskMarkdown(view()));
    expect(await writeRunFiles(repo, "run-1", { view: view(), state: {} })).toEqual({ conflict: false });
  });

  it("appends events as JSON lines", async () => {
    await appendEventLine(repo, "run-2", { type: "a" });
    await appendEventLine(repo, "run-2", { type: "b" });
    const lines = readFileSync(join(runDir(repo, "run-2"), "events.jsonl"), "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ type: "a" }, { type: "b" }]);
  });

  it("writes artifacts and rejects unsafe names", async () => {
    const path = await writeArtifact(repo, "run-3", "diff.patch", "patch");
    expect(path).toBe(join(runDir(repo, "run-3"), "artifacts", "diff.patch"));
    expect(readFileSync(path, "utf8")).toBe("patch");
    for (const bad of ["../x", "a/b", "..", ""]) {
      await expect(writeArtifact(repo, "run-3", bad, "x")).rejects.toThrow(/invalid artifact name/);
    }
  });
});
