import type { AgentNode, AgentStep, ContextSample, RunTrace } from "@/lib/run-trace/types";

// Each beat advances the agent's clock by `after` seconds, then records one step.
type Beat =
  | { after: number; think: string }
  | { after: number; say: string }
  | { after: number; read: string; result?: string }
  | { after: number; edit: string; summary?: string }
  | { after: number; write: string }
  | { after: number; bash: string; result: string; error?: boolean }
  | { after: number; grep: string; result: string }
  | { after: number; spawn: AgentNode };

type Script = {
  id: string;
  role: string;
  description?: string;
  model?: string;
  start: number;
  prompt: string;
  baseTokens: number;
  beats: Beat[];
  tail?: number;
};

const RUN_START = Date.parse("2026-11-07T14:02:11.000Z");

const iso = (seconds: number) => new Date(RUN_START + seconds * 1000).toISOString();

let toolSeq = 0;

function agent(script: Script): AgentNode {
  const steps: AgentStep[] = [{ kind: "prompt", text: script.prompt, timestamp: iso(script.start) }];
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const context: ContextSample[] = [];
  const children: AgentNode[] = [];
  let clock = script.start;
  let tokens = script.baseTokens;

  const sample = (grow: number, out: number) => {
    tokens += grow;
    context.push({ timestamp: iso(clock), tokens, outputTokens: out });
  };
  const tool = (name: string, summary: string, input: unknown, extra: Partial<Extract<AgentStep, { kind: "tool" }>["call"]> = {}) => {
    toolSeq += 1;
    steps.push({
      kind: "tool",
      call: { id: `toolu_${String(toolSeq).padStart(4, "0")}`, name, summary, input, timestamp: iso(clock), ...extra },
    });
  };

  sample(0, 120);
  for (const beat of script.beats) {
    clock += beat.after;
    if ("think" in beat) {
      steps.push({ kind: "thinking", text: beat.think, timestamp: iso(clock) });
      sample(400, 600);
    } else if ("say" in beat) {
      steps.push({ kind: "text", text: beat.say, timestamp: iso(clock) });
      sample(250, 300);
    } else if ("read" in beat) {
      filesRead.add(beat.read);
      tool("Read", beat.read, { file_path: beat.read }, { result: beat.result ?? `(${beat.read}: 180 lines)` });
      sample(2_800 + beat.read.length * 40, 90);
    } else if ("edit" in beat) {
      filesEdited.add(beat.edit);
      tool("Edit", beat.edit, { file_path: beat.edit }, { result: beat.summary ?? "The file has been updated." });
      sample(900, 700);
    } else if ("write" in beat) {
      filesEdited.add(beat.write);
      tool("Write", beat.write, { file_path: beat.write }, { result: `File created: ${beat.write}` });
      sample(1_600, 1_400);
    } else if ("bash" in beat) {
      tool("Bash", beat.bash, { command: beat.bash }, { result: beat.result, isError: beat.error });
      sample(1_200 + beat.result.length * 3, 80);
    } else if ("grep" in beat) {
      tool("Grep", beat.grep, { pattern: beat.grep }, { result: beat.result });
      sample(700, 60);
    } else {
      children.push(beat.spawn);
      const spawnedAt = clock;
      clock = (Date.parse(beat.spawn.startedAt) - RUN_START) / 1000;
      tool(
        "Agent",
        `${beat.spawn.role}: ${beat.spawn.description ?? ""}`,
        { subagent_type: beat.spawn.role, description: beat.spawn.description },
        { childAgentId: beat.spawn.id, result: `Agent ${beat.spawn.id} finished.` },
      );
      clock = Math.max(spawnedAt, (Date.parse(beat.spawn.endedAt) - RUN_START) / 1000);
      sample(1_800, 200);
    }
  }
  clock += script.tail ?? 4;

  return {
    id: script.id,
    role: script.role,
    description: script.description,
    model: script.model ?? "claude-opus-5-5",
    startedAt: iso(script.start),
    endedAt: iso(clock),
    steps,
    filesRead: [...filesRead],
    filesEdited: [...filesEdited],
    context,
    children,
  };
}

const planner = agent({
  id: "a-planner",
  role: "marrow-planner",
  description: "Split the build into tickets",
  start: 14,
  baseTokens: 14_200,
  prompt:
    "Read docs/roadmap.md and the open issues labelled `build:next`. Produce at most two independent tickets for this build, each with acceptance criteria and the files it should touch.",
  beats: [
    { after: 3, think: "Two candidates stand out: the `--json` flag for `marrow build` and the resolver cache. They touch disjoint modules, so they can run in parallel." },
    { after: 4, read: "docs/roadmap.md" },
    { after: 6, bash: "gh issue list --label build:next --json number,title", result: '[{"number":41,"title":"marrow build --json"},{"number":44,"title":"Cache resolved dependency graph"}]' },
    { after: 5, read: "src/cli/build.ts" },
    { after: 4, read: "src/resolve/graph.ts" },
    { after: 3, grep: "resolveGraph\\(", result: "src/cli/build.ts:58\nsrc/resolve/graph.ts:12\nsrc/watch/index.ts:91" },
    { after: 8, think: "The cache must key on the lockfile hash, not mtime: CI checkouts reset mtimes. Say so in the ticket or the implementer will pick mtime." },
    { after: 9, write: ".marrow/build/tickets.md" },
    { after: 2, say: "Two tickets: MRW-41 (`--json` output) and MRW-44 (resolver cache keyed on lockfile hash). Written to .marrow/build/tickets.md." },
  ],
});

function ticket(n: number, start: number, opts: { title: string; files: string[]; test: string; fail?: boolean }) {
  const testWriter = agent({
    id: `a-tests-${n}`,
    role: "marrow-test-writer",
    description: `Tests for MRW-${n}`,
    start,
    baseTokens: 16_800,
    prompt: `Write failing tests for MRW-${n}: ${opts.title}. Do not touch implementation files.`,
    beats: [
      { after: 3, read: ".marrow/build/tickets.md" },
      { after: 4, read: opts.files[0] },
      { after: 5, think: `The acceptance criteria name two behaviours; one test each, plus the edge case of an empty workspace.` },
      { after: 3, read: opts.test.replace(/\.test\.ts$/, ".ts") },
      { after: 12, write: opts.test },
      { after: 6, bash: `pnpm vitest run ${opts.test}`, result: "FAIL  3 failed (3)\n  expected undefined to equal { ok: true }", error: true },
      { after: 2, say: `Three failing tests in ${opts.test}; they fail for the right reason.` },
    ],
  });
  const implementer = agent({
    id: `a-impl-${n}`,
    role: "marrow-implementer",
    description: `Implement MRW-${n}`,
    start: start + 1,
    baseTokens: 21_400,
    prompt: `Implement MRW-${n}: ${opts.title}. Tests are being written in parallel at ${opts.test}; make them pass without editing them.`,
    beats: [
      { after: 3, read: ".marrow/build/tickets.md" },
      ...opts.files.map((file, i) => ({ after: 3 + i, read: file })),
      { after: 4, grep: "export function", result: opts.files.map((f) => `${f}:1`).join("\n") },
      { after: 9, think: "Smallest change first: thread an option through, keep the default path byte-for-byte the same." },
      ...opts.files.map((file, i) => ({ after: 10 + i * 4, edit: file })),
      { after: 30, bash: `pnpm vitest run ${opts.test}`, result: opts.fail ? "FAIL  1 failed | 2 passed (3)\n  cache hit returned stale graph" : "PASS  3 passed (3)", error: opts.fail },
      ...(opts.fail
        ? ([
            { after: 6, think: "Stale graph: the key hashes the lockfile path, not its contents." },
            { after: 8, edit: opts.files[0], summary: "Hash lockfile contents with sha256." },
            { after: 14, bash: `pnpm vitest run ${opts.test}`, result: "PASS  3 passed (3)" },
          ] satisfies Beat[])
        : []),
      { after: 10, bash: "pnpm typecheck", result: "Tasks: 4 successful, 4 total" },
      { after: 2, say: `MRW-${n} done: ${opts.files.length} files changed, tests green.` },
    ],
  });
  return [testWriter, implementer];
}

const [tests41, impl41] = ticket(41, 72, {
  title: "`marrow build --json` prints a machine-readable summary",
  files: ["src/cli/build.ts", "src/cli/format.ts"],
  test: "src/cli/build.test.ts",
});
const [tests44, impl44] = ticket(44, 73, {
  title: "cache the resolved dependency graph keyed on the lockfile",
  files: ["src/resolve/cache.ts", "src/resolve/graph.ts", "src/cli/build.ts"],
  test: "src/resolve/cache.test.ts",
  fail: true,
});

const endOf = (...nodes: AgentNode[]) => Math.max(...nodes.map((n) => (Date.parse(n.endedAt) - RUN_START) / 1000));
const reviewStart = endOf(tests41, impl41, tests44, impl44) + 5;

function reviewer(id: string, focus: string, offset: number, verdict: string): AgentNode {
  return agent({
    id,
    role: "marrow-reviewer",
    description: `Review: ${focus}`,
    start: reviewStart + offset,
    baseTokens: 18_000,
    prompt: `Review the diff on this branch for ${focus}. Report blocking issues only, with file and line.`,
    beats: [
      { after: 3, bash: "git diff main --stat", result: " src/cli/build.ts | 41 +++--\n src/cli/format.ts | 22 +\n src/resolve/cache.ts | 64 ++++\n src/resolve/graph.ts | 9 +-" },
      { after: 4, bash: "git diff main", result: "diff --git a/src/resolve/cache.ts b/src/resolve/cache.ts\n+export async function loadCached(lock: string) {\n+  const key = sha256(await readFile(lock))\n..." },
      { after: 5, read: "src/resolve/cache.ts" },
      { after: 4, read: "src/cli/build.ts" },
      { after: 9, think: `Looking for ${focus}. The cache writes to .marrow/cache without creating the directory first.` },
      { after: 6, say: verdict },
    ],
  });
}

const reviewers = [
  reviewer("a-review-correctness", "correctness", 0, "One blocking issue: src/resolve/cache.ts:22 writes before `mkdir -p`; first run on a clean checkout throws ENOENT."),
  reviewer("a-review-api", "public API and CLI output stability", 1, "No blocking issues. `--json` output shape matches the ticket."),
];

const fixer = agent({
  id: "a-fix-44",
  role: "marrow-implementer",
  description: "Fix review: cache mkdir",
  start: endOf(...reviewers) + 3,
  baseTokens: 19_500,
  prompt: "Reviewer found: src/resolve/cache.ts:22 writes before `mkdir -p`. Fix it and add a test for a clean checkout.",
  beats: [
    { after: 3, read: "src/resolve/cache.ts" },
    { after: 6, edit: "src/resolve/cache.ts", summary: "mkdir(dir, { recursive: true }) before write." },
    { after: 5, edit: "src/resolve/cache.test.ts" },
    { after: 18, bash: "pnpm vitest run src/resolve", result: "PASS  4 passed (4)" },
    { after: 2, say: "Fixed and covered." },
  ],
});

const skeptic = agent({
  id: "a-skeptic",
  role: "marrow-skeptic",
  description: "Try to break the build",
  start: endOf(fixer) + 2,
  baseTokens: 22_000,
  prompt: "Assume the build is wrong. Find one concrete way it breaks a user, or say plainly that you could not.",
  beats: [
    { after: 4, think: "Concurrency: two `marrow build` processes sharing a cache dir. Does the write race leave a half-written graph?" },
    { after: 5, read: "src/resolve/cache.ts" },
    { after: 6, bash: "node scripts/race-cache.mjs --procs 8", result: "8/8 builds succeeded; cache file valid JSON after each run" },
    { after: 8, think: "Writes go through a temp file and rename, so they are atomic. JSON output on a failed build?" },
    { after: 5, bash: "marrow build --json --project fixtures/broken; echo $?", result: '{"ok":false,"errors":[{"file":"src/a.ts","message":"Cannot resolve ./b"}]}\n1' },
    { after: 3, say: "Could not break it. Concurrent builds are safe (atomic rename) and --json reports failures with a non-zero exit." },
  ],
});

const root = agent({
  id: "a-main",
  role: "main",
  description: "marrow build runner",
  start: 0,
  baseTokens: 11_000,
  prompt: "/marrow-build Run the next build: plan it, write tests and implement each ticket in parallel, review, then have the skeptic try to break it.",
  beats: [
    { after: 2, think: "Plan first; nothing can run in parallel until the tickets exist." },
    { after: 3, read: "CLAUDE.md" },
    { after: 4, read: ".marrow/build/config.json" },
    { after: 5, spawn: planner },
    { after: 2, read: ".marrow/build/tickets.md" },
    { after: 1, say: "Starting MRW-41 and MRW-44: test-writer and implementer for each, in parallel." },
    { after: 0, spawn: tests41 },
    { after: 0, spawn: impl41 },
    { after: 0, spawn: tests44 },
    { after: 0, spawn: impl44 },
    { after: 3, bash: "pnpm vitest run", result: "Test Files 14 passed (14)\nTests 96 passed (96)" },
    { after: 0, spawn: reviewers[0] },
    { after: 0, spawn: reviewers[1] },
    { after: 2, think: "One blocking finding. Send it back to an implementer rather than fixing it here." },
    { after: 0, spawn: fixer },
    { after: 0, spawn: skeptic },
    { after: 3, bash: "git add -A && git commit -m 'build: MRW-41, MRW-44'", result: "[build/2026-11-07 3f9c2e1] build: MRW-41, MRW-44\n 7 files changed, 188 insertions(+), 14 deletions(-)" },
    { after: 2, say: "Build complete: MRW-41 and MRW-44 landed, one review fix, skeptic found nothing." },
  ],
});

export const SAMPLE_TRACE: RunTrace = {
  sessionId: "sample-0c1e7a2f",
  title: "marrow build 2026-11-07 (sample)",
  root,
};
