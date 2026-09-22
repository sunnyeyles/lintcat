/** The command line: what `pr-review` was asked to do, before anything is read. */
import type { LocalScope } from "@pr-review/mcp/local-review";

/** The severity that makes a review fail; "off" never fails. */
export type FailOn = "low" | "medium" | "high" | "off";

const FAIL_ON: readonly FailOn[] = ["low", "medium", "high", "off"];

const SCOPES = ["working-tree", "staged", "range"] as const;

export interface ReviewOptions {
  kind: "review";
  /** The checkout to review; undefined means the working directory. */
  repoPath: string | undefined;
  base: string | undefined;
  scope: LocalScope;
  index: boolean;
  failOn: FailOn;
  /** Let the review's own structured log through to stderr. */
  verbose: boolean;
  color: boolean | undefined;
}

interface InstallHookOptions {
  kind: "install-hook";
  repoPath: string | undefined;
  failOn: FailOn;
  /** What the hook runs; undefined means the command line that installed it. */
  command: string | undefined;
  /** Overwrite a pre-push hook this command did not write. */
  force: boolean;
}

export type Command =
  | ReviewOptions
  | InstallHookOptions
  | { kind: "help" }
  | { kind: "version" };

/** A command line that cannot be run; the message is shown with the usage text. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

interface Flags {
  values: Map<string, string>;
  switches: Set<string>;
  /** Known-shaped flags given no value; reported only once the name is known. */
  missing: Set<string>;
}

const SWITCHES = new Set([
  "no-index",
  "verbose",
  "force",
  "color",
  "no-color",
  "help",
  "h",
  "version",
]);

/** Reads `--name value`, `--name=value` and the known bare switches. */
function readFlags(argv: readonly string[]): Flags {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const missing = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--") && argument !== "-h") {
      throw new UsageError(`unexpected argument ${JSON.stringify(argument)}`);
    }
    const name = argument.replace(/^--?/, "").split("=")[0]!;
    const inline = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : undefined;
    if (SWITCHES.has(name) && inline === undefined) {
      switches.add(name);
      continue;
    }
    const value = inline ?? argv[++index];
    if (value === undefined) {
      missing.add(name);
      continue;
    }
    values.set(name, value);
  }
  return { values, switches, missing };
}

/** An unknown name is reported before a missing value, so a typo reads as one. */
function known(flags: Flags, allowed: readonly string[]): void {
  for (const name of [...flags.values.keys(), ...flags.switches, ...flags.missing]) {
    if (!allowed.includes(name)) {
      throw new UsageError(`unknown option --${name}`);
    }
  }
  const [valueless] = flags.missing;
  if (valueless !== undefined) {
    throw new UsageError(`--${valueless} needs a value`);
  }
}

function readFailOn(flags: Flags): FailOn {
  const value = flags.values.get("fail-on") ?? "high";
  if (!FAIL_ON.includes(value as FailOn)) {
    throw new UsageError(`--fail-on must be one of ${FAIL_ON.join(", ")}, not ${JSON.stringify(value)}`);
  }
  return value as FailOn;
}

function readColor(flags: Flags): boolean | undefined {
  if (flags.switches.has("no-color")) return false;
  if (flags.switches.has("color")) return true;
  return undefined;
}

function readScope(flags: Flags): LocalScope {
  const range = flags.values.get("range");
  const named = flags.values.get("scope") ?? (range === undefined ? "working-tree" : "range");
  const kind = SCOPES.find((scope) => scope === named);
  if (kind === undefined) {
    throw new UsageError(`--scope must be one of ${SCOPES.join(", ")}, not ${JSON.stringify(named)}`);
  }
  if (kind === "range") {
    if (range === undefined) {
      throw new UsageError('--scope range needs a --range, e.g. --range "HEAD~3..HEAD"');
    }
    return { kind, range };
  }
  if (range !== undefined) {
    throw new UsageError(`a --range cannot be reviewed with --scope ${kind}; drop one of them`);
  }
  return { kind };
}

const REVIEW_FLAGS = [
  "repo",
  "base",
  "scope",
  "range",
  "fail-on",
  "no-index",
  "verbose",
  "color",
  "no-color",
];

function reviewOptions(flags: Flags): ReviewOptions {
  known(flags, REVIEW_FLAGS);
  return {
    kind: "review",
    repoPath: flags.values.get("repo"),
    base: flags.values.get("base"),
    scope: readScope(flags),
    index: !flags.switches.has("no-index"),
    failOn: readFailOn(flags),
    verbose: flags.switches.has("verbose"),
    color: readColor(flags),
  };
}

function installHookOptions(flags: Flags): InstallHookOptions {
  known(flags, ["repo", "fail-on", "command", "force"]);
  return {
    kind: "install-hook",
    repoPath: flags.values.get("repo"),
    failOn: readFailOn(flags),
    command: flags.values.get("command"),
    force: flags.switches.has("force"),
  };
}

/** Reads the argument list; `review` is the command when none is named. */
export function parseArguments(argv: readonly string[]): Command {
  const named = argv[0] !== undefined && !argv[0].startsWith("-");
  const command = named ? argv[0]! : "review";
  const flags = readFlags(argv.slice(named ? 1 : 0));
  if (flags.switches.has("help") || flags.switches.has("h")) {
    return { kind: "help" };
  }
  if (flags.switches.has("version")) {
    return { kind: "version" };
  }
  if (command === "review") {
    return reviewOptions(flags);
  }
  if (command === "install-hook") {
    return installHookOptions(flags);
  }
  if (command === "help") {
    return { kind: "help" };
  }
  if (command === "version") {
    return { kind: "version" };
  }
  throw new UsageError(`unknown command ${JSON.stringify(command)}`);
}
