/** The command line: what `factory` was asked to do, before anything is read. */
import { PROFILE_NAMES, type ProfileName } from "@pr-review/factory";

export type Command =
  | { kind: "init"; repoPath: string | undefined }
  | {
      kind: "new";
      outcome: string;
      repoPath: string | undefined;
      profile: ProfileName | undefined;
      pr: boolean;
      run: boolean;
    }
  | { kind: "run" | "resume" | "cancel" | "result"; runId: string }
  | { kind: "worker"; pollMs: number }
  | { kind: "status"; runId: string | undefined }
  | { kind: "logs"; runId: string; follow: boolean }
  | { kind: "mcp" }
  | { kind: "report"; json: boolean; repoPath: string | undefined; sinceDays: number | undefined }
  | { kind: "prune"; days: number | undefined }
  | { kind: "bench-run"; configPath: string; fixtures: string[] | undefined; keep: boolean }
  | { kind: "bench-compare"; a: string; b: string }
  | { kind: "help" }
  | { kind: "version" };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const USAGE = `Usage: factory <command> [options]

Commands:
  init [--repo <path>]                 Check Docker and the database, build the sandbox image
  new "<outcome>" [--repo <path>]      Discover, approve and run a task
      [--profile quick|bugfix|feature|refactor] [--pr] [--no-run]
  run <id>                             Run a queued run in the foreground
  resume <id>                          Recover a run whose worker died
  worker [--poll-ms <n>]               Run queued tasks until interrupted
  status [<id>]                        One run, or the recent runs and per-profile summary
  logs <id> [-f]                       A run's events; -f follows until it finishes
  cancel <id>                          Cancel a run
  result <id>                          Branch, PR, checks, usage and task.md
  mcp                                  Serve the factory as MCP tools over stdio (docs/factory/mcp.md)
  report [--json] [--repo <path>]      Per-profile metrics and the learning report
      [--since-days <n>]
  prune [--days <n>]                   Drop old runs' events and commands (FACTORY_RETENTION_DAYS)
  bench run --config <file>            Run benchmark fixtures, judged by hidden checks
      [--fixture a,b] [--keep]           (evaluate is an alias of bench)
  bench compare <a> <b>                Compare two configs' results (config files or result dirs)
  help | version

Exit codes: 0 ok, 1 run failed or cancelled, 2 usage error, 3 environment problem.`;

const SWITCHES = new Set(["pr", "no-run", "f", "follow", "help", "h", "version", "json", "keep"]);

function readDays(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) throw new UsageError(`--${flag} must be a whole number of days`);
  return days;
}

interface Parsed {
  positional: string[];
  values: Map<string, string>;
  switches: Set<string>;
}

function read(argv: readonly string[]): Parsed {
  const parsed: Parsed = { positional: [], values: new Map(), switches: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") {
      parsed.positional.push(...argv.slice(index + 1));
      break;
    }
    if (!argument.startsWith("-") || argument === "-") {
      parsed.positional.push(argument);
      continue;
    }
    const name = argument.replace(/^--?/, "").split("=")[0]!;
    const inline = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : undefined;
    if (SWITCHES.has(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
      parsed.switches.add(name);
      continue;
    }
    const value = inline ?? argv[++index];
    if (value === undefined) throw new UsageError(`--${name} needs a value`);
    parsed.values.set(name, value);
  }
  return parsed;
}

function allow(parsed: Parsed, names: readonly string[]): void {
  for (const name of [...parsed.values.keys(), ...parsed.switches]) {
    if (!names.includes(name)) throw new UsageError(`unknown option --${name}`);
  }
}

function positionals(parsed: Parsed, command: string, count: number, label: string): string[] {
  if (parsed.positional.length > count) {
    throw new UsageError(`unexpected argument ${JSON.stringify(parsed.positional[count])}`);
  }
  if (parsed.positional.length < count) throw new UsageError(`${command} needs ${label}`);
  return parsed.positional;
}

function runIdCommand(kind: "run" | "resume" | "cancel" | "result", parsed: Parsed): Command {
  allow(parsed, []);
  const [runId] = positionals(parsed, kind, 1, "a run id");
  return { kind, runId: runId! };
}

function readProfile(value: string | undefined): ProfileName | undefined {
  if (value === undefined) return undefined;
  const profile = PROFILE_NAMES.find((name) => name === value);
  if (!profile) throw new UsageError(`--profile must be one of ${PROFILE_NAMES.join(", ")}, not ${JSON.stringify(value)}`);
  return profile;
}

function readPollMs(value: string | undefined): number {
  if (value === undefined) return 2_000;
  const pollMs = Number(value);
  if (!Number.isInteger(pollMs) || pollMs < 100) throw new UsageError(`--poll-ms must be an integer of at least 100`);
  return pollMs;
}

export function parseArguments(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (command === undefined) return { kind: "help" };
  const parsed = read(rest);
  if (command === "help" || command === "--help" || command === "-h" || parsed.switches.has("help") || parsed.switches.has("h")) {
    return { kind: "help" };
  }
  if (command === "version" || command === "--version" || parsed.switches.has("version")) return { kind: "version" };

  switch (command) {
    case "init":
      allow(parsed, ["repo"]);
      positionals(parsed, command, 0, "");
      return { kind: "init", repoPath: parsed.values.get("repo") };
    case "new": {
      allow(parsed, ["repo", "profile", "pr", "no-run"]);
      const [outcome] = positionals(parsed, command, 1, 'a desired outcome, e.g. factory new "add a --json flag"');
      if (!outcome!.trim()) throw new UsageError("the outcome is empty");
      return {
        kind: "new",
        outcome: outcome!,
        repoPath: parsed.values.get("repo"),
        profile: readProfile(parsed.values.get("profile")),
        pr: parsed.switches.has("pr"),
        run: !parsed.switches.has("no-run"),
      };
    }
    case "run":
    case "resume":
    case "cancel":
    case "result":
      return runIdCommand(command, parsed);
    case "worker":
      allow(parsed, ["poll-ms"]);
      positionals(parsed, command, 0, "");
      return { kind: "worker", pollMs: readPollMs(parsed.values.get("poll-ms")) };
    case "status": {
      allow(parsed, []);
      if (parsed.positional.length > 1) throw new UsageError(`unexpected argument ${JSON.stringify(parsed.positional[1])}`);
      return { kind: "status", runId: parsed.positional[0] };
    }
    case "report":
      allow(parsed, ["json", "repo", "since-days"]);
      positionals(parsed, command, 0, "");
      return { kind: "report", json: parsed.switches.has("json"), repoPath: parsed.values.get("repo"), sinceDays: readDays(parsed.values.get("since-days"), "since-days") };
    case "prune":
      allow(parsed, ["days"]);
      positionals(parsed, command, 0, "");
      return { kind: "prune", days: readDays(parsed.values.get("days"), "days") };
    case "bench":
    case "evaluate": {
      const [action, ...rest] = parsed.positional;
      if (action === "run") {
        allow(parsed, ["config", "fixture", "keep"]);
        if (rest.length) throw new UsageError(`unexpected argument ${JSON.stringify(rest[0])}`);
        const configPath = parsed.values.get("config");
        if (!configPath) throw new UsageError(`${command} run needs --config <file>`);
        const fixtures = parsed.values.get("fixture")?.split(",").map((f) => f.trim()).filter(Boolean);
        return { kind: "bench-run", configPath, fixtures, keep: parsed.switches.has("keep") };
      }
      if (action === "compare") {
        allow(parsed, []);
        if (rest.length !== 2) throw new UsageError(`${command} compare needs two configs or result directories`);
        return { kind: "bench-compare", a: rest[0]!, b: rest[1]! };
      }
      throw new UsageError(`${command} needs run or compare`);
    }
    case "mcp":
      allow(parsed, []);
      positionals(parsed, command, 0, "");
      return { kind: "mcp" };
    case "logs": {
      allow(parsed, ["f", "follow"]);
      const [runId] = positionals(parsed, command, 1, "a run id");
      return { kind: "logs", runId: runId!, follow: parsed.switches.has("f") || parsed.switches.has("follow") };
    }
    default:
      throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  }
}
