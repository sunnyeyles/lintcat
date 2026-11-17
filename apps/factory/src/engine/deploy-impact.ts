/** Deterministic deploy hazards in a run's final diff: env vars, migrations, workflows, deploy config. */
import { parse } from "yaml";

import { renderMessage } from "#src/engine/prompts";

type Severity = "fix" | "prerequisite" | "note";

export interface DeployFinding {
  rule: string;
  severity: Severity;
  file: string;
  line?: number;
  subject: string;
  detail: string;
}

export interface DeployImpact {
  findings: DeployFinding[];
  changed: { migrations: string[]; workflows: string[]; deployConfig: string[]; manifests: string[] };
}

export interface DeployImpactConfig {
  envExamples: string[];
  migrations: string[];
  deployConfig: string[];
  ignoreEnv: string[];
}

export const DEFAULT_DEPLOY_CONFIG: DeployImpactConfig = {
  envExamples: ["**/.env.example", "**/.env.sample", "**/.env.template"],
  migrations: ["**/drizzle/*.sql", "**/migrations/**/*.sql", "**/prisma/migrations/*/migration.sql"],
  deployConfig: [],
  ignoreEnv: [],
};

type ChangeStatus = "A" | "M" | "D" | "R";

export interface AnalyseInput {
  diff: string;
  files: string[];
  baseStatus: Map<string, ChangeStatus>;
  readBase: (path: string) => Promise<string | null>;
  readHead: (path: string) => Promise<string | null>;
  listHead: () => Promise<string[]>;
  baseHasToken: (token: string) => Promise<boolean>;
  config: DeployImpactConfig;
}

interface AddedLine {
  line: number;
  text: string;
}

const DEPLOY_CONFIG_GLOBS = [
  "**/Dockerfile*",
  "**/compose*.y*ml",
  "**/docker-compose*.y*ml",
  "**/vercel.json",
  "**/fly.toml",
  "**/*.tf",
  "**/serverless.y*ml",
];
const WORKFLOW_GLOB = ".github/workflows/*.{yml,yaml}";
const ALWAYS_SET_ENV = new Set(["NODE_ENV", "CI", "PORT"]);
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENV_PATTERNS = [
  /process\.env\.([A-Za-z_]\w*)/g,
  /process\.env\[\s*["'`]([^"'`]+)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_]\w*)/g,
  /os\.environ\[\s*["']([^"']+)["']\s*\]/g,
  /os\.environ\.get\(\s*["']([^"']+)["']/g,
  /os\.getenv\(\s*["']([^"']+)["']/g,
  /os\.Getenv\(\s*"([^"]+)"/g,
  /env::var\(\s*"([^"]+)"/g,
];
const SEVERITY_ORDER: Record<Severity, number> = { prerequisite: 0, fix: 1, note: 2 };

const escapeRegExp = (text: string) => text.replace(/[.+^$()|[\]\\{}?*]/g, "\\$&");

/** `**` spans directories (`**\/` may match none), `*` stays within one, `{a,b}` lists literal options. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{" && glob.indexOf("}", i) > i) {
      const end = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, end).split(",").map(escapeRegExp).join("|")})`;
      i = end;
    } else re += escapeRegExp(c);
  }
  return new RegExp(`^${re}$`);
}

const matcher = (globs: readonly string[]) => {
  const res = globs.map(globToRegExp);
  return (file: string) => res.some((re) => re.test(file));
};

/** Head-side line numbers of every added line, per file. */
export function addedLines(diff: string): Map<string, AddedLine[]> {
  const out = new Map<string, AddedLine[]>();
  let file: string | null = null;
  let inHunk = false;
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      file = null;
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith("+++ ")) {
        const target = raw.slice(4).trim();
        file = target === "/dev/null" ? null : target.replace(/^"?b\//, "").replace(/"$/, "");
      }
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      inHunk = true;
      line = Number(hunk[1]);
      continue;
    }
    if (!inHunk || file === null) continue;
    if (raw.startsWith("+")) {
      out.set(file, [...(out.get(file) ?? []), { line, text: raw.slice(1) }]);
      line++;
    } else if (raw.startsWith(" ")) line++;
  }
  return out;
}

export async function analyse(input: AnalyseInput): Promise<DeployImpact> {
  const { files, config } = input;
  const changedSet = new Set(files);
  const added = addedLines(input.diff);
  const addedIn = (file: string) => (changedSet.has(file) ? (added.get(file) ?? []) : []);
  const isMigration = matcher(config.migrations);
  const isWorkflow = matcher([WORKFLOW_GLOB]);
  const isDeployConfig = matcher([...DEPLOY_CONFIG_GLOBS, ...config.deployConfig]);
  const isManifest = (f: string) => f === "package.json" || f.endsWith("/package.json");

  const changed = {
    migrations: files.filter(isMigration),
    workflows: files.filter(isWorkflow),
    deployConfig: files.filter(isDeployConfig),
    manifests: files.filter(isManifest),
  };
  const findings = [
    ...(await envFindings(input, addedIn)),
    ...(await migrationFindings(input, changed.migrations)),
    ...(await workflowFindings(input, changed.workflows, addedIn)),
    ...changed.deployConfig.map(
      (file): DeployFinding => ({
        rule: "deploy.config",
        severity: "note",
        file,
        subject: file,
        detail: `\`${file}\` changes how the app is built or deployed; check it against the running service`,
      }),
    ),
    ...(await dependencyFindings(input, changed.manifests, addedIn)),
  ];
  const stray = findings.find((f) => !changedSet.has(f.file));
  if (stray) throw new Error(`deploy-impact finding ${stray.rule} names ${stray.file}, which this change does not touch`);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { findings, changed };
}

async function envFindings(input: AnalyseInput, addedIn: (file: string) => AddedLine[]): Promise<DeployFinding[]> {
  const { files, config } = input;
  const isExample = matcher(config.envExamples);
  const ignored = new Set([...ALWAYS_SET_ENV, ...config.ignoreEnv]);
  const seen = new Map<string, { file: string; line: number }>();
  for (const file of files) {
    if (isExample(file)) continue;
    for (const { line, text } of addedIn(file)) {
      for (const pattern of ENV_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          const name = match[1]!;
          if (ENV_NAME.test(name) && !ignored.has(name) && !seen.has(name)) seen.set(name, { file, line });
        }
      }
    }
  }
  if (seen.size === 0) return [];

  const examples = (await input.listHead()).filter(isExample);
  const declared = new Set<string>();
  for (const example of examples) {
    const text = (await input.readHead(example)) ?? "";
    for (const m of text.matchAll(/^[ \t]*#?[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=/gm)) declared.add(m[1]!);
  }
  const exampleFile = examples[0] ?? ".env.example";

  const findings: DeployFinding[] = [];
  for (const [name, at] of seen) {
    if (await input.baseHasToken(name)) continue;
    if (!declared.has(name)) {
      findings.push({ rule: "env.undeclared", severity: "fix", ...at, subject: name, detail: `\`${name}\` is read but no env example file declares it; add \`# ${name}=\` to \`${exampleFile}\`` });
    }
    findings.push({ rule: "env.new", severity: "prerequisite", ...at, subject: name, detail: `set \`${name}\` wherever this app runs before deploying` });
  }
  return findings;
}

const BREAKING: RegExp[] = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bRENAME\b/i,
  /\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
];

/** Comments become spaces of the same length, so offsets still map to lines. */
function sqlStatements(sql: string): { text: string; line: number }[] {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  const cleaned = sql
    .replace(/-->\s*statement-breakpoint/g, (m) => `;${blank(m.slice(1))}`)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, blank);
  const statements: { text: string; line: number }[] = [];
  let offset = 0;
  for (const part of cleaned.split(";")) {
    const lead = part.length - part.trimStart().length;
    const text = part.trim().replace(/\s+/g, " ");
    if (text) statements.push({ text, line: cleaned.slice(0, offset + lead).split("\n").length });
    offset += part.length + 1;
  }
  return statements;
}

function addsRequiredColumn(statement: string): boolean {
  return statement
    .split(/,(?=\s*ADD\b)/i)
    .some((clause) => /\bADD\s+COLUMN\b/i.test(clause) && /\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause));
}

const clip = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}...` : text);

async function migrationFindings(input: AnalyseInput, migrations: string[]): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = [];
  for (const file of migrations) {
    const status = input.baseStatus.get(file) ?? "A";
    if (status !== "A") {
      findings.push({ rule: "migration.edited", severity: "fix", file, subject: file, detail: `\`${file}\` is an existing migration and applied history must not change; restore it and put the change in a new migration` });
      continue;
    }
    for (const { text, line } of sqlStatements((await input.readHead(file)) ?? "")) {
      const subject = clip(text);
      if (BREAKING.some((re) => re.test(text)) || addsRequiredColumn(text)) {
        findings.push({ rule: "migration.breaking", severity: "prerequisite", file, line, subject, detail: `\`${subject}\` runs before the deploy, so the old code serves against it until the deploy finishes` });
      } else if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(text) && !/\bCONCURRENTLY\b/i.test(text)) {
        findings.push({ rule: "migration.locking", severity: "note", file, line, subject, detail: `\`${subject}\` blocks writes while it builds; consider CREATE INDEX CONCURRENTLY` });
      } else if (/\bADD\s+CONSTRAINT\b/i.test(text) && !/\bNOT\s+VALID\b/i.test(text)) {
        findings.push({ rule: "migration.locking", severity: "note", file, line, subject, detail: `\`${subject}\` scans the table under lock; consider NOT VALID, then VALIDATE CONSTRAINT` });
      }
    }
  }
  return findings;
}

type Permissions = string | Record<string, unknown> | undefined;

function parseYaml(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const doc: unknown = parse(text);
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `permissions` blocks keyed by where they sit: "the workflow" or "job <id>". */
function permissionBlocks(doc: Record<string, unknown> | null): Map<string, Permissions> {
  const blocks = new Map<string, Permissions>();
  if (!doc) return blocks;
  if ("permissions" in doc) blocks.set("the workflow", doc.permissions as Permissions);
  const jobs = doc.jobs && typeof doc.jobs === "object" ? (doc.jobs as Record<string, unknown>) : {};
  for (const [id, job] of Object.entries(jobs)) {
    if (job && typeof job === "object" && "permissions" in job) blocks.set(`job ${id}`, (job as Record<string, unknown>).permissions as Permissions);
  }
  return blocks;
}

const jobIds = (doc: Record<string, unknown> | null) => new Set(doc?.jobs && typeof doc.jobs === "object" ? Object.keys(doc.jobs) : []);

function triggers(doc: Record<string, unknown> | null): Set<string> {
  const on = doc?.on;
  if (typeof on === "string") return new Set([on]);
  if (Array.isArray(on)) return new Set(on.filter((t): t is string => typeof t === "string"));
  return new Set(on && typeof on === "object" ? Object.keys(on) : []);
}

async function workflowFindings(input: AnalyseInput, workflows: string[], addedIn: (file: string) => AddedLine[]): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = [];
  for (const file of workflows) {
    const status = input.baseStatus.get(file) ?? "A";
    if (status === "D") continue;
    const lines = addedIn(file);
    const lineOf = (re: RegExp) => lines.find((l) => re.test(l.text))?.line;
    const head = parseYaml(await input.readHead(file));
    const base = status === "A" ? null : parseYaml(await input.readBase(file));
    const permission = (subject: string, detail: string, line?: number) =>
      findings.push({ rule: "workflow.permissions", severity: "prerequisite", file, ...(line ? { line } : {}), subject, detail });

    if (head) {
      const baseBlocks = permissionBlocks(base);
      const headBlocks = permissionBlocks(head);
      const headJobs = jobIds(head);
      for (const [where, before] of baseBlocks) {
        const jobGone = where.startsWith("job ") && !headJobs.has(where.slice(4));
        if (!headBlocks.has(where) && before !== undefined && !jobGone) {
          permission(`permissions of ${where}`, `the \`permissions\` block of ${where} was removed, so it falls back to the repository's default token scopes`);
        }
      }
      for (const [where, after] of headBlocks) {
        const before = baseBlocks.get(where);
        if (before === "write-all") continue;
        if (after === "write-all") {
          permission(`permissions of ${where}`, `${where} now asks for \`write-all\``, lineOf(/write-all/));
          continue;
        }
        if (!after || typeof after !== "object") continue;
        for (const [scope, value] of Object.entries(after)) {
          const had = before && typeof before === "object" ? (before as Record<string, unknown>)[scope] : undefined;
          if (value === "write" && had !== "write") {
            permission(`${scope}: write`, `${where} gains \`${scope}: write\``, lineOf(new RegExp(`\\b${escapeRegExp(scope)}\\s*:\\s*write\\b`)));
          }
        }
      }
      const baseTriggers = triggers(base);
      for (const trigger of ["pull_request_target", "workflow_run"]) {
        if (triggers(head).has(trigger) && !baseTriggers.has(trigger)) {
          findings.push({ rule: "workflow.trigger", severity: "prerequisite", file, ...withLine(lineOf(new RegExp(`\\b${trigger}\\b`))), subject: trigger, detail: `\`${trigger}\` runs with secrets and write access on code from outside the branch; review it before merging` });
        }
      }
    }

    const secrets = new Map<string, number>();
    for (const { line, text } of lines) {
      const uses = /^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)/.exec(text)?.[1];
      if (uses && !uses.startsWith("./") && !uses.startsWith("docker://")) {
        const ref = uses.includes("@") ? uses.slice(uses.lastIndexOf("@") + 1) : "";
        if (!/^[0-9a-f]{40}$/.test(ref)) {
          findings.push({ rule: "workflow.unpinned", severity: "note", file, line, subject: uses, detail: `\`${uses}\` is not pinned to a commit SHA, so its code can change under you` });
        }
      }
      for (const m of text.matchAll(/\bsecrets\.([A-Za-z_]\w*)/g)) {
        if (m[1] !== "GITHUB_TOKEN" && !secrets.has(m[1]!)) secrets.set(m[1]!, line);
      }
    }
    for (const [name, line] of secrets) {
      if (await input.baseHasToken(`secrets.${name}`)) continue;
      findings.push({ rule: "workflow.secret", severity: "prerequisite", file, line, subject: name, detail: `add the Actions secret \`${name}\`` });
    }
  }
  return findings;
}

const withLine = (line: number | undefined) => (line ? { line } : {});

function dependencyNames(text: string | null): Map<string, string> {
  if (text === null) return new Map();
  try {
    const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    return new Map(Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies }));
  } catch {
    return new Map();
  }
}

async function dependencyFindings(input: AnalyseInput, manifests: string[], addedIn: (file: string) => AddedLine[]): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = [];
  for (const file of manifests) {
    const status = input.baseStatus.get(file) ?? "A";
    if (status === "D") continue;
    const before = dependencyNames(status === "A" ? null : await input.readBase(file));
    for (const [name, version] of dependencyNames(await input.readHead(file))) {
      if (before.has(name)) continue;
      const line = addedIn(file).find((l) => l.text.includes(JSON.stringify(name)))?.line;
      findings.push({ rule: "deps.added", severity: "note", file, ...withLine(line), subject: `${name}@${version}`, detail: `new runtime dependency \`${name}@${version}\` ships with the deploy` });
    }
  }
  return findings;
}

const findingLine = (f: DeployFinding) => `**${f.rule}** \`${f.file}${f.line ? `:${f.line}` : ""}\`: ${f.detail}`;

export function deployRepairPrompt(fix: readonly DeployFinding[]): string {
  return renderMessage("implementer", "deploy-repair", { findings: fix.map((f) => `- ${findingLine(f)}`).join("\n") });
}

export function renderDeployImpact(impact: DeployImpact): string[] {
  if (impact.findings.length === 0) return ["No deploy impact detected."];
  return impact.findings.map((f) => `- ${findingLine(f)}`);
}

export function beforeDeploying(impact: DeployImpact | undefined): string[] {
  const blocking = (impact?.findings ?? []).filter((f) => f.severity !== "note");
  return blocking.length ? ["", "## Before deploying", "", ...blocking.map((f) => `- [ ] ${findingLine(f)}`)] : [];
}
