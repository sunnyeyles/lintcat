/** The read-only learning report: recurring failures clustered by deterministic rules, no model call. */
import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

import type { FactoryDatabase } from "#src/store/client";
import { EXPECTED_FAILURE_STAGES, loadRunHistory, type HistoryFilter, type RunHistory } from "#src/metrics";
import { expireLessons, upsertLessons, type LessonInput } from "#src/store/lessons";
import type { LessonTarget } from "#src/store/schema";

export const LESSON_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

interface Candidate {
  target: LessonTarget;
  change: string;
  confidence: number;
}

export interface FailureCluster {
  key: string;
  source: "command" | "blocker" | "repeated_failure";
  label: string;
  signature: string;
  runIds: string[];
  occurrences: number;
  profiles: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  rootCause: string;
  candidates: Candidate[];
}

export interface LearningReport {
  generatedAt: Date;
  runsAnalysed: number;
  clusters: FailureCluster[];
  lessons: LessonInput[];
}

const ERROR_LINE = /error|fail|assert|cannot|not found|unexpected|expected|denied|refused|timed? ?out|enoent|eaddr/i;

/** Strips what varies between runs of the same failure: paths, ids, numbers, quoted values. */
export function normaliseText(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/\br[0-9a-z]{8}[0-9a-f]{8}\b/g, "<run>")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,64}\b/gi, "<hex>")
    .replace(/(?:\/[\w.@-]+)+/g, "<path>")
    .replace(/(["'`]).*?\1/g, "<str>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

/** The first line that reads like an error, normalised; the whole output's first line otherwise. */
export function outputSignature(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => ERROR_LINE.test(l)) ?? lines[0] ?? "";
  return normaliseText(line) || "<no output>";
}

interface Occurrence {
  source: FailureCluster["source"];
  label: string;
  signature: string;
  category: string | null;
  stage: string | null;
  runId: string;
  profile: string;
  at: Date;
}

interface Rule {
  test: (o: Occurrence) => boolean;
  rootCause: (o: Occurrence) => string;
  candidates: (o: Occurrence) => Candidate[];
}

// First match wins, so the specific rules come before the generic check-failure one.
const RULES: Rule[] = [
  {
    test: (o) => o.category === "command_not_found",
    rootCause: (o) => `\`${o.label}\` calls a program the sandbox image does not have`,
    candidates: () => [
      { target: "sandbox", change: "add the missing program to the sandbox image, or install it in the setup step", confidence: 0.8 },
      { target: "tool", change: "list the image's available programs in the sandbox_exec tool description", confidence: 0.5 },
    ],
  },
  {
    test: (o) => o.category === "timeout",
    rootCause: (o) => `\`${o.label}\` exceeds the command timeout`,
    candidates: () => [
      { target: "workflow", change: "raise commandTimeoutSeconds for this profile, or split the check", confidence: 0.6 },
      { target: "sandbox", change: "give the sandbox more CPU if the check is CPU-bound", confidence: 0.4 },
    ],
  },
  {
    test: (o) => o.category === "killed",
    rootCause: (o) => `\`${o.label}\` was killed (exit 137), most likely by the sandbox memory limit`,
    candidates: () => [{ target: "sandbox", change: "raise the sandbox memory or pids limit for this repository", confidence: 0.6 }],
  },
  {
    test: (o) => o.source === "command" && o.label === "prepare/install",
    rootCause: () => "dependency install fails before the agent starts",
    candidates: () => [
      { target: "sandbox", change: "check registry access and lockfile support in the setup step", confidence: 0.6 },
      { target: "workflow", change: "declare the install step explicitly in .factory/checks", confidence: 0.4 },
    ],
  },
  {
    test: (o) => /no checks detected/.test(o.signature),
    rootCause: () => "the repository has no checks the factory can detect",
    candidates: () => [{ target: "workflow", change: "have `factory init` require .factory/checks before a run can be approved", confidence: 0.8 }],
  },
  {
    test: (o) => /made no changes|changed nothing/.test(o.signature),
    rootCause: () => "the agent finished without editing the worktree",
    candidates: () => [
      { target: "context", change: "pass the locate results as explicit file paths, not search hits", confidence: 0.5 },
      { target: "prompt", change: "require the implementer to edit files before reporting done", confidence: 0.5 },
    ],
  },
  {
    test: (o) => o.source === "repeated_failure" || /failed identically/.test(o.signature),
    rootCause: () => "a repair pass left the failure byte-for-byte the same",
    candidates: () => [
      { target: "prompt", change: "tell the repair agent to rerun the failing check with sandbox_exec before finishing", confidence: 0.6 },
      { target: "context", change: "include more of the failing output in the repair prompt", confidence: 0.4 },
    ],
  },
  {
    test: (o) => /still failing after/.test(o.signature),
    rootCause: () => "checks keep failing after every repair pass the budget allows",
    candidates: () => [
      { target: "prompt", change: "have the implementer run the profile's checks itself before reporting done", confidence: 0.5 },
      { target: "workflow", change: "consider one more repair pass for this profile", confidence: 0.3 },
    ],
  },
  {
    test: (o) => /implementer blocked/.test(o.signature),
    rootCause: () => "the approved spec left the implementer without information it needed",
    candidates: () => [{ target: "prompt", change: "have discovery ask about the gap these blockers name before proposing a spec", confidence: 0.5 }],
  },
  {
    test: (o) => /ended with/.test(o.signature),
    rootCause: (o) => `the agent stopped early (${o.signature})`,
    candidates: () => [{ target: "workflow", change: "raise maxAgentTurns, or narrow the plan the spec asks for", confidence: 0.5 }],
  },
  {
    test: (o) => /not enabled/.test(o.signature),
    rootCause: () => "work was routed to a profile that is turned off",
    candidates: () => [{ target: "workflow", change: "enable the profile, or route this category to an enabled one", confidence: 0.7 }],
  },
  {
    test: (o) => /recoveries/.test(o.signature),
    rootCause: () => "runs crash repeatedly and exhaust recovery",
    candidates: () => [{ target: "sandbox", change: "look for host-side crashes or lease expiries in factory.log", confidence: 0.5 }],
  },
  {
    test: (o) => o.source === "command" && o.stage === "verify",
    rootCause: (o) => `check \`${o.label}\` fails the same way across runs`,
    candidates: (o) => [
      { target: "prompt", change: `tell the implementer to run \`${o.label.split("/")[1]}\` with sandbox_exec before reporting done`, confidence: 0.5 },
      { target: "context", change: "add the check's conventions to the implement prompt", confidence: 0.3 },
    ],
  },
];

const FALLBACK: Rule = {
  test: () => true,
  rootCause: (o) => `recurring ${o.source.replace("_", " ")}: ${o.signature}`,
  candidates: () => [{ target: "prompt", change: "read the evidence runs; no rule matches this failure yet", confidence: 0.2 }],
};

function occurrences(history: RunHistory): Occurrence[] {
  const found: Occurrence[] = [];
  for (const run of history.runs) {
    const base = { runId: run.id, profile: run.profile! };
    for (const command of history.commandsByRun.get(run.id) ?? []) {
      if ((command.exitCode === 0 && !command.timedOut) || EXPECTED_FAILURE_STAGES.has(command.stage)) continue;
      found.push({
        ...base,
        source: "command",
        label: `${command.stage}/${command.name}`,
        signature: outputSignature(command.output),
        category: command.timedOut ? "timeout" : command.errorCategory,
        stage: command.stage,
        at: command.startedAt,
      });
    }
    for (const event of history.eventsByRun.get(run.id) ?? []) {
      if (event.kind !== "repeated_failure") continue;
      found.push({ ...base, source: "repeated_failure", label: event.stage ?? "verify", signature: "repeated identical failure", category: null, stage: event.stage, at: event.at });
    }
    if (run.status === "failed" && run.blocker) {
      found.push({
        ...base,
        source: "blocker",
        label: "blocker",
        signature: normaliseText(run.blocker),
        category: null,
        stage: null,
        at: run.finishedAt ?? run.createdAt,
      });
    }
  }
  return found;
}

const shortHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Confidence grows with distinct runs, capped below certainty: these are hypotheses. */
function scaled(base: number, runs: number): number {
  return Math.round(Math.min(0.95, base * Math.min(1, 0.6 + 0.1 * runs)) * 100) / 100;
}

export function buildLearningReport(history: RunHistory, { now = new Date(), minRuns = 2 } = {}): LearningReport {
  const groups = new Map<string, Occurrence[]>();
  for (const o of occurrences(history)) {
    const key = [o.source, o.label, o.category ?? "-", o.signature].join("|");
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const clusters: FailureCluster[] = [];
  for (const [key, members] of groups) {
    const runIds = [...new Set(members.map((m) => m.runId))].sort();
    if (runIds.length < minRuns) continue;
    const first = members[0]!;
    const rule = RULES.find((r) => r.test(first)) ?? FALLBACK;
    const times = members.map((m) => m.at.getTime());
    clusters.push({
      key: shortHash(key),
      source: first.source,
      label: first.label,
      signature: first.signature,
      runIds,
      occurrences: members.length,
      profiles: [...new Set(members.map((m) => m.profile))].sort(),
      firstSeenAt: new Date(Math.min(...times)),
      lastSeenAt: new Date(Math.max(...times)),
      rootCause: rule.rootCause(first),
      candidates: rule.candidates(first).map((c) => ({ ...c, confidence: scaled(c.confidence, runIds.length) })),
    });
  }
  clusters.sort((a, b) => b.runIds.length - a.runIds.length || a.key.localeCompare(b.key));
  const lessons = clusters.flatMap((cluster) =>
    cluster.candidates.map(
      (candidate): LessonInput => ({
        key: `${candidate.target}:${cluster.key}`,
        scope: cluster.profiles.length === 1 ? `profile:${cluster.profiles[0]}` : "all-profiles",
        target: candidate.target,
        title: `${cluster.label}: ${cluster.signature}`.slice(0, 200),
        rootCause: cluster.rootCause,
        proposal: candidate.change,
        confidence: candidate.confidence,
        evidenceRunIds: cluster.runIds,
        occurrences: cluster.occurrences,
        firstSeenAt: cluster.firstSeenAt,
        lastSeenAt: cluster.lastSeenAt,
        expiresAt: new Date(cluster.lastSeenAt.getTime() + LESSON_TTL_DAYS * DAY_MS),
      }),
    ),
  );
  return { generatedAt: now, runsAnalysed: history.runs.length, clusters, lessons };
}

/** Records this report's lessons as proposed, then retires expired ones: its only writes. */
export async function learningReport(
  database: FactoryDatabase,
  filter: HistoryFilter = {},
  { now = new Date(), minRuns = 2 } = {},
): Promise<LearningReport & { expired: number }> {
  const report = buildLearningReport(await loadRunHistory(database, filter), { now, minRuns });
  await upsertLessons(database, report.lessons);
  const expired = await expireLessons(database, now);
  return { ...report, expired };
}
