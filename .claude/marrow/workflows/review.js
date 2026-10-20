export const meta = {
  name: 'marrow-review',
  description: 'Review one branch: checks, reviewers, skeptic',
  whenToUse: 'Started by /marrow review with absolute paths in args; not for direct use',
  phases: [
    { title: 'Checks', detail: 'marrow-runner runs checks.sh in the background, in its own worktree' },
    { title: 'Review', detail: 'standards, bugs, plus spec when a spec is given and ui when the diff touches UI files' },
    { title: 'Skeptic', detail: 'refute findings only with cited code' },
  ],
}

// args: { repoPath, branch, worktree, checksWorktree, base, head, baseBranch, specPath (absolute or null), marrowDir, uiFiles (ui-files.sh's list) }
const A = args || {}
for (const k of ['repoPath', 'branch', 'worktree', 'checksWorktree', 'base', 'head', 'marrowDir']) {
  if (!A[k] || typeof A[k] !== 'string') throw new Error(`marrow-review: missing args.${k}`)
}
for (const k of ['repoPath', 'worktree', 'checksWorktree', 'marrowDir']) {
  if (!A[k].startsWith('/')) throw new Error(`marrow-review: args.${k} must be absolute`)
}
// Builds rewrite tracked files, so checks never share the worktree the reviewers read.
if (A.checksWorktree === A.worktree) throw new Error('marrow-review: args.checksWorktree must differ from args.worktree')
if (!Array.isArray(A.uiFiles)) throw new Error('marrow-review: args.uiFiles must be an array (pass JSON, not a string)')
const SPEC = A.specPath || null
const UI_FILES = A.uiFiles
const SCRIPTS = `${A.marrowDir}/scripts`
const BASE_BRANCH = A.baseBranch || 'main'

const RUN_SCHEMA = {
  type: 'object',
  properties: {
    exit_code: { type: 'integer', description: 'exit code of the command' },
    stdout_json: { type: 'string', description: 'the JSON the command printed on stdout, verbatim' },
    stderr_tail: { type: 'string', description: 'last 30 lines of stderr' },
  },
  required: ['exit_code', 'stdout_json'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: { type: 'string' },
          file: { type: 'string', description: 'path relative to the repo root' },
          line: { type: 'integer', description: 'line at head; 0 when there is none' },
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'string', description: 'quoted code, rule or spec line' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'category', 'file', 'line', 'title', 'detail', 'evidence'],
      },
    },
    incomplete: { type: 'boolean', description: 'true when a check could not run; never pass on missing data' },
    incomplete_reason: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' }, description: 'standards files or spec read' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'incomplete'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
          reason: { type: 'string' },
          citation: { type: 'string', description: 'file:line and the quoted code; required to refute' },
        },
        required: ['id', 'verdict', 'reason'],
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdicts'],
}

const context = [
  `Repo: ${A.repoPath}`,
  `Branch: ${A.branch}`,
  `Worktree (read-only, detached at head): ${A.worktree}`,
  `Base (the origin/${BASE_BRANCH} merge-base; the fixed point): ${A.base}`,
  `Head: ${A.head}`,
  `Diff: git -C ${A.worktree} diff ${A.base}...${A.head}`,
  `Commits: git -C ${A.worktree} log --oneline ${A.base}..${A.head}`,
  `Spec: ${SPEC || 'none given'}`,
  `Marrow dir: ${A.marrowDir}`,
  `Repo notes: ${A.repoPath}/.marrow/notes.md`,
  '',
  `First read ${A.worktree}/CLAUDE.md and ${A.worktree}/AGENTS.md if present.`,
  'You were started with a different directory\'s CLAUDE.md, so this repo\'s rules come only from those files.',
  'Read-only: do not edit, commit, check out, build or run tests. The runner is running the checks in a separate worktree, so this one stays at head.',
].join('\n')

// Every agent() goes through logged(), so the skill can write the agent log.
const LOG = []
let SEQ = 0
function outcomeOf(r) {
  if (!r) return 'no result (agent died or was skipped)'
  if (r.verdicts) return `${r.verdicts.length} verdict(s)`
  if (r.findings) return `${r.findings.length} finding(s)${r.incomplete ? ', incomplete' : ''}`
  if (typeof r.exit_code === 'number') return `exit ${r.exit_code}`
  return 'returned'
}
async function logged(prompt, opts) {
  const seq = ++SEQ
  const r = await agent(prompt, opts)
  const outcome = outcomeOf(r)
  log(`${opts.label}: ${outcome}`)
  LOG.push({ seq, phase: opts.phase, label: opts.label, agent: opts.agentType, outcome })
  return r
}

function parseRun(r, what) {
  if (!r) return { ok: false, error: `${what}: the runner returned nothing` }
  try {
    return { exit_code: r.exit_code, ...JSON.parse(r.stdout_json) }
  } catch (e) {
    return { ok: false, exit_code: r.exit_code, error: `${what}: output was not JSON`, raw: String(r.stdout_json).slice(0, 4000), stderr: r.stderr_tail || '' }
  }
}

async function runChecks() {
  const r = await logged(
    [
      'Each command is its own Bash call with a 600000 ms timeout.',
      '',
      `1. "${SCRIPTS}/run-checks.sh" start "${A.checksWorktree}"`,
      '   It starts the checks in the background and prints a run directory.',
      `2. "${SCRIPTS}/run-checks.sh" wait "<the run directory>"`,
      '   Exit 75 means still running: run the same wait command again, as many times as it takes. Stop at the first other exit code.',
      '',
      'Report the last wait: its exit code in exit_code, the JSON it printed on stdout in stdout_json exactly as printed, and its stderr in stderr_tail.',
      'A non-zero exit other than 75 is a result: do not rerun it or try to fix anything.',
    ].join('\n'),
    { agentType: 'marrow-runner', effort: 'low', schema: RUN_SCHEMA, phase: 'Checks', label: 'checks' },
  )
  return parseRun(r, 'checks.sh')
}

const REVIEWERS = {
  standards: { agentType: 'marrow-review-standards', heading: 'Standards' },
  spec: { agentType: 'marrow-review-spec', heading: 'Spec' },
  bugs: { agentType: 'marrow-review-bugs', heading: 'Bugs and security' },
  ui: { agentType: 'marrow-review-ui', heading: 'UI' },
}

function reviewerPrompt(name) {
  const lines = [context, '']
  if (name === 'spec') lines.push(`Review the diff against the spec at ${SPEC}, and the tickets beside it.`)
  if (name === 'ui') lines.push(`UI files changed: ${UI_FILES.join(', ')}`)
  lines.push('Return every finding through the schema. An empty findings list is a fine answer when there is nothing.')
  return lines.join('\n')
}

async function runReviewers() {
  const names = ['standards', 'bugs']
  const skipped = []
  if (SPEC) names.push('spec')
  else skipped.push({ name: 'spec', why: 'no spec path given' })
  if (UI_FILES.length) names.push('ui')
  else skipped.push({ name: 'ui', why: 'the diff touches no UI files' })
  const results = await parallel(names.map(n => () =>
    logged(reviewerPrompt(n), {
      agentType: REVIEWERS[n].agentType, schema: FINDINGS_SCHEMA, phase: 'Review', label: n,
    })))
  const out = {}
  names.forEach((n, i) => {
    const r = results[i]
    out[n] = r || { findings: [], incomplete: true, incomplete_reason: 'the reviewer returned nothing' }
    out[n].findings = (out[n].findings || []).map((f, j) => ({ ...f, id: `${n}-${j + 1}`, reviewer: n }))
  })
  return { byReviewer: out, ran: names, skipped }
}

async function runSkeptic(findings) {
  if (!findings.length) return {}
  const slim = findings.map(f => ({
    id: f.id, reviewer: f.reviewer, severity: f.severity, category: f.category,
    file: f.file, line: f.line, title: f.title, detail: f.detail, evidence: f.evidence,
  }))
  const r = await logged(
    [
      context,
      '',
      'Judge each of these findings. Give exactly one verdict per id.',
      'Refute only with a citation (file:line plus the quoted code that proves it wrong). A high finding is refuted only on proof; doubt is uncertain.',
      '',
      JSON.stringify(slim, null, 1),
    ].join('\n'),
    { agentType: 'marrow-skeptic', schema: VERDICT_SCHEMA, phase: 'Skeptic', label: 'skeptic' },
  )
  const byId = {}
  for (const v of (r && r.verdicts) || []) byId[v.id] = v
  return byId
}

// ---- run: checks alongside review → skeptic ----

const [checks, review] = await parallel([
  () => runChecks(),
  async () => {
    const reviewed = await runReviewers()
    const all = Object.values(reviewed.byReviewer).flatMap(r => r.findings)
    const verdicts = await runSkeptic(all)
    return { reviewed, all, verdicts }
  },
])

const checksR = checks || { ok: false, error: 'the checks runner failed' }
const rv = review || { reviewed: { byReviewer: {}, ran: [], skipped: [] }, all: [], verdicts: {} }

const open = []
const refuted = []
for (const f of rv.all) {
  const v = rv.verdicts[f.id]
  const withV = { ...f, verdict: v ? v.verdict : 'unjudged', verdict_reason: v ? v.reason : '', citation: v ? (v.citation || '') : '' }
  if (v && v.verdict === 'refuted' && (v.citation || '').trim()) refuted.push(withV)
  else if (v && v.verdict === 'refuted') open.push({ ...withV, verdict: 'refuted without a citation, so kept' })
  else open.push(withV)
}
const openHigh = open.filter(f => f.severity === 'high')

// ---- report ----

const SEV_ORDER = { high: 0, medium: 1, low: 2 }
const md = []
const checksOk = checksR.ok === true
md.push(`# Review: \`${A.branch}\``)
md.push('')
md.push(`- Repo: \`${A.repoPath}\``)
md.push(`- Head: \`${A.head}\``)
md.push(`- Base (origin/${BASE_BRANCH} merge-base): \`${A.base}\``)
md.push(`- Worktree: \`${A.worktree}\``)
md.push(`- Checks worktree: \`${A.checksWorktree}\``)
md.push(`- Spec: ${SPEC ? `\`${SPEC}\`` : 'none given'}`)
md.push('')
md.push(`**Checks ${checksOk ? 'green' : 'RED'}. ${open.length} open finding(s), ${openHigh.length} high. ${refuted.length} refuted.**`)
md.push('')

md.push('## Checks')
md.push('')
if (checksR.error) {
  md.push(`Checks did not run cleanly: ${checksR.error}`)
  if (checksR.raw) md.push('', '```', checksR.raw, '```')
  if (checksR.log_dir) md.push('', `Logs: \`${checksR.log_dir}\``)
} else {
  md.push('| Step | Result | Seconds |')
  md.push('| --- | --- | --- |')
  for (const s of checksR.steps || []) md.push(`| ${s.name} | ${s.ok ? 'green' : `red (exit ${s.exit_code})`} | ${s.seconds} |`)
  if (checksR.failures) md.push('', `Red step output: \`${checksR.failures}\` (appended at the end of this report)`)
  for (const n of checksR.notes || []) md.push('', `Note: ${n}`)
  if (checksR.log_dir) md.push('', `Logs: \`${checksR.log_dir}\``)
}
md.push('')

md.push('## Findings')
for (const name of Object.keys(REVIEWERS)) {
  const r = rv.reviewed.byReviewer[name]
  if (!r) continue
  const mine = open.filter(f => f.reviewer === name).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  md.push('', `### ${REVIEWERS[name].heading}`, '')
  if (r.incomplete) md.push(`**Incomplete:** ${r.incomplete_reason || 'no reason given'}`, '')
  if (!mine.length) md.push('No open findings.')
  for (const f of mine) {
    md.push(`- **[${f.severity}] ${f.title}** (${f.category}) \`${f.file}${f.line ? `:${f.line}` : ''}\`, skeptic: ${f.verdict}`)
    md.push(`  ${f.detail}`)
    if (f.evidence) md.push(`  Evidence: ${f.evidence.replace(/\n/g, ' ').slice(0, 600)}`)
    if (f.suggestion) md.push(`  Fix: ${f.suggestion}`)
    if (f.verdict !== 'confirmed' && f.verdict_reason) md.push(`  Skeptic: ${f.verdict_reason}`)
  }
  for (const n of r.notes || []) md.push(`- Note: ${n}`)
}
md.push('')
md.push('## Not run')
md.push('')
if (!rv.reviewed.skipped.length) md.push('Every reviewer ran.')
for (const s of rv.reviewed.skipped) md.push(`- ${s.name}: ${s.why}`)
md.push('')
md.push(`## Refuted (${refuted.length})`)
md.push('')
if (!refuted.length) md.push('None.')
for (const f of refuted) {
  md.push(`- [${f.severity}] ${f.title} (${f.reviewer}) \`${f.file}${f.line ? `:${f.line}` : ''}\``)
  md.push(`  Why: ${f.verdict_reason}`)
  md.push(`  Citation: ${f.citation.replace(/\n/g, ' ').slice(0, 600)}`)
}
md.push('')

const lg = [`# Agent log: review \`${A.branch}\``, '', 'Every agent the review ran, in the order it started.', '',
  '| # | Phase | Label | Agent | Outcome |', '| --- | --- | --- | --- | --- |']
for (const e of [...LOG].sort((a, b) => a.seq - b.seq)) lg.push(`| ${e.seq} | ${e.phase} | ${e.label} | ${e.agent} | ${e.outcome} |`)

return {
  markdown: md.join('\n'),
  agentLogMarkdown: lg.join('\n'),
  summary: {
    branch: A.branch, head: A.head, checks_ok: checksOk,
    open: open.length, open_high: openHigh.length, refuted: refuted.length,
    reviewers_ran: rv.reviewed.ran, reviewers_skipped: rv.reviewed.skipped.map(s => s.name),
    incomplete: Object.entries(rv.reviewed.byReviewer).filter(([, r]) => r.incomplete).map(([n]) => n),
  },
  checks: checksR,
  findings_open: open,
  findings_refuted: refuted,
}
