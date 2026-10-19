export const meta = {
  name: 'marrow-build',
  description: 'Build an approved plan: test-first ticket lanes in waves, locked tests, judged attempts, review, fixes, final branch',
  whenToUse: 'Started by /marrow build (locally or in a cloud session) with build-args.sh output as args; not for direct use',
  phases: [
    { title: 'Prepare', detail: 'integration worktree on marrow/<feature>' },
    { title: 'Tests', detail: 'marrow-test-writer writes each ticket\'s acceptance tests; they must fail first' },
    { title: 'Implement', detail: 'marrow-implementer makes the locked tests pass inside owned paths; hard tickets get two attempts and a judge' },
    { title: 'Merge', detail: 'each green ticket merges into the integration branch; conflicts go to marrow-git-sync' },
    { title: 'Review', detail: 'checks, then standards (not with lite), spec, bugs and ui (when the diff touches UI files) reviewers, then the skeptic' },
    { title: 'Fix', detail: 'up to 2 rounds (1 with lite): fixes, checks, bugs on the fix diff, skeptic' },
    { title: 'Finalize', detail: 'acceptance ledger, rebase on the default branch, push marrow/<feature>, PR body' },
  ],
}

// args: build-args.sh output: { feature, lite, push, marrowDir, featureDir, specPath, planPath, repo, criteria, tickets, waves }
const A = args || {}
for (const k of ['feature', 'marrowDir', 'featureDir', 'specPath', 'planPath']) {
  if (!A[k] || typeof A[k] !== 'string') throw new Error(`marrow-build: missing args.${k}`)
}
const R = A.repo
if (!R || !R.worktree || !R.worktree.includes('/.claude/worktrees/marrow-')) throw new Error('marrow-build: args.repo is missing or its worktree is not .claude/worktrees/marrow-*')
if (!Array.isArray(A.tickets) || !A.tickets.length || !Array.isArray(A.waves) || !A.waves.length) throw new Error('marrow-build: args.tickets and args.waves must be non-empty arrays (pass JSON, not a string)')

const BASE_BRANCH = R.base_branch || 'main'
const S = `${A.marrowDir}/scripts`
const LANES = [1, 2, 3].includes(A.lanes) ? A.lanes : 3
const MAX_FIX_ROUNDS = A.lite ? 1 : 2
const TICKET_RETRIES = 2
const TICKET = {}
for (const t of A.tickets) TICKET[t.id] = t
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`
const short = s => s.length > 36 ? `${s.slice(0, 35)}…` : s
const laneWT = (id, alt) => `${R.path}/.claude/worktrees/marrow-${A.feature}-t${id}${alt ? '-b' : ''}`
const laneBranch = (id, alt) => `${R.branch}-t${id}${alt ? '-b' : ''}`
const testPaths = t => (t.tests && t.tests.paths) || []

// ---- schemas ----

const TIMES = { started_at: { type: 'string' }, finished_at: { type: 'string' } }
const COMMANDS = { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, exit_code: { type: 'integer' } }, required: ['cmd', 'exit_code'] } }
const RUN_SCHEMA = {
  type: 'object',
  properties: {
    exit_code: { type: 'integer', description: 'exit code of the command' },
    stdout_json: { type: 'string', description: 'what the command printed on stdout, verbatim' },
    stderr_tail: { type: 'string', description: 'last 30 lines of stderr' },
  },
  required: ['exit_code', 'stdout_json'],
}
const TESTS_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    commit: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' } },
    failure: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'commit'],
}
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    commits: { type: 'array', items: { type: 'string' } },
    files_changed: { type: 'array', items: { type: 'string' } },
    commands: COMMANDS,
    checklist: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, done: { type: 'boolean' } }, required: ['item', 'done'] } },
    fixes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fixed: { type: 'boolean' }, reason: { type: 'string' } }, required: ['id', 'fixed'] } },
    human_steps: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
    ...TIMES,
  },
  required: ['status', 'commits', 'files_changed', 'commands'],
}
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { winner: { type: 'string', enum: ['a', 'b'] }, reason: { type: 'string' }, breaking_input: { type: 'string' }, graft: { type: 'string' } },
  required: ['winner', 'reason'],
}
const SYNC_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'blocked', 'conflict'] },
    head: { type: 'string' }, base: { type: 'string' }, pushed_sha: { type: 'string' },
    conflicts_resolved: { type: 'boolean' }, conflict_files: { type: 'array', items: { type: 'string' } },
    pr_title: { type: 'string' }, pr_body: { type: 'string' },
    commands: COMMANDS, notes: { type: 'array', items: { type: 'string' } }, ...TIMES,
  },
  required: ['status', 'commands'],
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
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'category', 'file', 'line', 'title', 'detail', 'evidence'],
      },
    },
    incomplete: { type: 'boolean' },
    incomplete_reason: { type: 'string' },
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
        properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] }, reason: { type: 'string' }, citation: { type: 'string' } },
        required: ['id', 'verdict', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

// ---- agent log: every agent() goes through step() ----

const LOG = []
let SEQ = 0
async function step(prompt, o, meta = {}) {
  const seq = ++SEQ
  const r = await agent(prompt, { agentType: o.agentType, schema: o.schema, phase: o.phase, label: o.label, ...(o.effort ? { effort: o.effort } : {}) })
  const outcome = !r ? 'no result (agent died or was skipped)' : (meta.outcome ? meta.outcome(r) : 'returned')
  log(`${o.label}: ${outcome}`)
  LOG.push({
    seq, phase: o.phase, label: o.label, agent: o.agentType, ticket: meta.ticket || '', outcome,
    started_at: (r && r.started_at) || '', finished_at: (r && r.finished_at) || '',
    commits: (r && (r.commits || (r.commit ? [r.commit] : null))) || (r && r.pushed_sha ? [r.pushed_sha] : []),
    files: (r && (r.files_changed || r.files)) || [], commands: (r && r.commands) || [],
  })
  return r
}

// One deterministic script through the runner; returns its JSON plus exit_code.
async function sh(cmd, label, phase, ticket) {
  const r = await step(
    ['Run this one command with a 600000 ms timeout and report it:', '', cmd, '',
      'Put the exit code in exit_code, what it printed on stdout in stdout_json exactly as printed, and the last 30 lines of stderr in stderr_tail.'].join('\n'),
    { agentType: 'marrow-runner', effort: 'low', schema: RUN_SCHEMA, phase, label },
    { ticket, outcome: r => `exit ${r.exit_code}` })
  if (!r) return { ok: false, exit_code: -1, error: `${label}: the runner returned nothing` }
  try {
    return { exit_code: r.exit_code, ...JSON.parse(r.stdout_json) }
  } catch (e) {
    return { ok: false, exit_code: r.exit_code, error: `${label}: output was not JSON`, raw: String(r.stdout_json).slice(0, 2000), stderr: r.stderr_tail || '' }
  }
}

async function runChecks(wt, label, phase) {
  const r = await step(
    ['Each command is its own Bash call with a 600000 ms timeout.', '',
      `1. "${S}/run-checks.sh" start "${wt}"`, '   It prints a run directory.',
      `2. "${S}/run-checks.sh" wait "<the run directory>"`,
      '   Exit 75 means still running: run the same wait again, as many times as it takes. Stop at the first other exit code.', '',
      'Report the last wait: exit_code, stdout_json exactly as printed, stderr_tail. A non-zero exit other than 75 is a result, not something to fix.'].join('\n'),
    { agentType: 'marrow-runner', effort: 'low', schema: RUN_SCHEMA, phase, label },
    { outcome: r => `exit ${r.exit_code}` })
  if (!r) return { ok: false, error: 'the checks runner returned nothing' }
  try { return { exit_code: r.exit_code, ...JSON.parse(r.stdout_json) } } catch (e) { return { ok: false, error: 'checks output was not JSON', raw: String(r.stdout_json).slice(0, 2000) } }
}

// A tiny semaphore and a mutex, so lanes cap at LANES and merges never overlap.
function limiter(n) {
  let active = 0
  const queue = []
  const next = () => { if (active < n && queue.length) { active++; queue.shift()() } }
  return fn => new Promise((resolve, reject) => {
    queue.push(() => Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next() }))
    next()
  })
}
const laneSlot = limiter(LANES)
const mergeLock = limiter(1)

// ---- context ----

function ctx(wt, extra) {
  return [
    `Repo: ${R.name} (main checkout ${R.path}, base branch ${BASE_BRANCH})`,
    `Worktree: ${wt}`,
    `Spec: ${A.specPath}`,
    `Plan: ${A.planPath}`,
    `Marrow dir: ${A.marrowDir}`,
    `Repo notes: ${R.path}/.marrow/notes.md`,
    ...(extra || []),
  ].join('\n')
}
function ticketBrief(t) {
  const crit = (t.criteria || []).map(id => {
    const c = (A.criteria || []).find(x => x.id === id)
    return `- ${id}: ${c ? c.text : '(missing)'}`
  })
  return [
    `Ticket ${t.id}: ${t.title}`,
    `Goal: ${t.goal}`,
    `Criteria:\n${crit.join('\n') || '- none'}`,
    `Owned paths: ${(t.owns || []).join(', ')}`,
    `Acceptance tests: ${testPaths(t).join(', ') || 'none'}${t.tests && t.tests.command ? `, run with: ${t.tests.command}` : ''}`,
    (t.tests && t.tests.helpers && t.tests.helpers.length) ? `Test helpers: ${t.tests.helpers.join(', ')}` : '',
    `Steps:\n${(t.steps || []).map(s => `- ${s}`).join('\n') || '- none listed'}`,
    t.notes ? `Planner notes: ${t.notes}` : '',
  ].filter(Boolean).join('\n')
}

// ---- prepare ----

const res = {
  status: 'blocked', why: '', base: '', head: '', tickets: {}, waves: [], reviewers: null, checks: null,
  open: [], refuted: [], fixed: [], rounds: 0, human_steps: [], notes: [], conflicts: [], ledger: null,
  final: null, pushed: false, risk: null,
}
for (const t of A.tickets) {
  res.tickets[t.id] = { id: t.id, title: t.title, status: 'pending', difficulty: t.difficulty || 'normal', notes: [], attempts: [], judge: null, tests_commit: '', merged: false }
  for (const h of t.human_steps || []) res.human_steps.push(`${t.id}: ${h}`)
}
log(`${A.feature}: ${A.tickets.length} ticket(s) in ${A.waves.length} wave(s) ${A.waves.map(w => `[${w.join(',')}]`).join(' → ')}; up to ${LANES} lanes; ${A.lite ? 'lite' : 'full'} review`)

phase('Prepare')
const int = await sh(`"${S}/lane.sh" create ${q(R.path)} ${q(`origin/${BASE_BRANCH}`)} ${q(R.worktree)} ${q(R.branch)}`, 'integration worktree', 'Prepare')
if (!int.ok) {
  res.why = `could not prepare the integration worktree: ${int.error || JSON.stringify(int.setup || int).slice(0, 300)}`
} else {
  res.base = int.base
  res.head = int.head
  // A rerun reuses the integration branch (local, or origin's on a new machine): tickets already merged there aren't built again.
  if (int.from === 'origin') log(`${R.branch}: continuing from origin/${R.branch}`)
  const prior = await sh(`"${S}/lane.sh" merged ${q(R.worktree)}`, 'tickets merged earlier', 'Prepare')
  for (const id of (prior && prior.merged) || []) {
    if (!res.tickets[id]) continue
    res.tickets[id].merged = true
    res.tickets[id].status = 'merged'
    res.tickets[id].tests_commit = (prior.tests_commits || {})[id] || ''
    res.tickets[id].notes.push('merged by an earlier run')
  }
}

// ---- one ticket lane ----

async function writeTests(t, wt, laneBase, problems) {
  const tw = await step(
    [ctx(wt, [`Lane base: ${laneBase}`]), '', ticketBrief(t), '',
      problems ? `Your earlier tests didn't pass the red check:\n${problems.map(p => `- ${p}`).join('\n')}\nFix that, amend nothing, and make a new commit.` : 'Write the acceptance tests now. They must fail.'].join('\n'),
    { agentType: 'marrow-test-writer', schema: TESTS_SCHEMA, phase: 'Tests', label: `${t.id} tests${problems ? ' (retry)' : ''}` },
    { ticket: t.id, outcome: r => `${r.status}${r.commit ? ` ${r.commit.slice(0, 10)}` : ''}` })
  const red = await sh(`"${S}/verify-ticket.sh" red ${q(wt)} ${q(A.planPath)} ${t.id} ${laneBase}`, `${t.id} red check`, 'Tests', t.id)
  return { tw, red }
}

async function implementOnce(t, wt, testsCommit, approach, label, verify) {
  const prompt = [ctx(wt, [`Acceptance tests commit (locked): ${testsCommit}`]), '', ticketBrief(t), '',
    approach ? `Approach: ${approach}` : '',
    verify ? `The last verification failed:\n${verify.problems.map(p => `- ${p}`).join('\n')}\n${verify.tail ? `Test output tail:\n${verify.tail}` : ''}\nFix the cause and make one new commit.` :
      'Make the acceptance tests pass, inside the owned paths, in one commit. Leave the tree clean.'].filter(Boolean).join('\n')
  const r = await step(prompt, { agentType: 'marrow-implementer', schema: IMPL_SCHEMA, phase: 'Implement', label },
    { ticket: t.id, outcome: r => `${r.status}, ${(r.commits || []).length} commit(s)` })
  const v = await sh(`"${S}/verify-ticket.sh" green ${q(wt)} ${q(A.planPath)} ${t.id} ${testsCommit}`, `${label} verify`, 'Implement', t.id)
  return { impl: r, verify: v }
}

// Implement, then re-verify up to TICKET_RETRIES times.
async function attempt(t, wt, testsCommit, approach, tag) {
  let a = await implementOnce(t, wt, testsCommit, approach, `${t.id} ${tag}`)
  for (let i = 1; i <= TICKET_RETRIES && !(a.verify && a.verify.ok); i++) {
    if (!a.verify || !a.verify.problems) break
    a = await implementOnce(t, wt, testsCommit, approach, `${t.id} ${tag} retry ${i}`, a.verify)
  }
  return { ...a, wt, tag }
}

async function lane(t) {
  const tr = res.tickets[t.id]
  if (tr.merged) return
  const blockers = (t.blocked_by || []).filter(b => !res.tickets[b] || !res.tickets[b].merged)
  if (blockers.length) {
    tr.status = 'skipped'
    tr.notes.push(`blocked by ${blockers.join(', ')}, which didn't merge`)
    return
  }
  const wtA = laneWT(t.id)
  const made = await sh(`"${S}/lane.sh" create ${q(R.path)} ${q(R.branch)} ${q(wtA)} ${q(laneBranch(t.id))} --fresh`, `${t.id} lane`, 'Tests', t.id)
  if (!made.ok) { tr.status = 'blocked'; tr.notes.push(`lane: ${made.error || 'setup failed'}`); return }
  const laneBase = made.head
  let testsCommit = laneBase
  const tests = testPaths(t)

  if (tests.length) {
    await sh(`"${S}/lane.sh" lock ${q(wtA)} ${q(JSON.stringify({ tests, test_helpers: (t.tests && t.tests.helpers) || [], owns: t.owns || [], locked: [] }))}`, `${t.id} lock tests`, 'Tests', t.id)
    let { tw, red } = await writeTests(t, wtA, laneBase)
    // Fail closed: only a red check that ran and passed lets the lane go on.
    const redWhy = r => r && r.ok === true ? [] : ((r && r.problems && r.problems.length) ? r.problems : [`the red check did not run: ${(r && (r.error || r.stderr)) || 'no result'}`])
    if (redWhy(red).length) ({ tw, red } = await writeTests(t, wtA, laneBase, redWhy(red)))
    if (!tw || tw.status !== 'done') { tr.status = 'blocked'; tr.notes.push(`test writer: ${tw ? (tw.notes || []).join('; ') || tw.status : 'no result'}`); return }
    if (redWhy(red).length) { tr.status = 'blocked'; tr.notes.push(`red check: ${redWhy(red).join('; ')}`); return }
    testsCommit = red.head
    tr.tests_commit = testsCommit
    tr.tests = tw.tests || []
  }
  const lock = { owns: t.owns || [], tests, test_helpers: (t.tests && t.tests.helpers) || [], locked: tests }
  await sh(`"${S}/lane.sh" lock ${q(wtA)} ${q(JSON.stringify(lock))}`, `${t.id} lock code`, 'Implement', t.id)

  let attempts
  if (t.difficulty === 'hard') {
    const wtB = laneWT(t.id, true)
    const mb = await sh(`"${S}/lane.sh" create ${q(R.path)} ${testsCommit} ${q(wtB)} ${q(laneBranch(t.id, true))}`, `${t.id} lane b`, 'Implement', t.id)
    if (mb.ok) {
      await sh(`"${S}/lane.sh" lock ${q(wtB)} ${q(JSON.stringify(lock))}`, `${t.id} lock b`, 'Implement', t.id)
      const runA = () => attempt(t, wtA, testsCommit, 'The most direct design that fits the patterns already in this code.', 'a')
      const runB = () => attempt(t, wtB, testsCommit, 'Before coding, sketch two designs and build the one with the smaller interface over the same behaviour; it need not be the obvious one.', 'b')
      // One lane means shared test resources, so the two attempts take turns.
      attempts = LANES === 1 ? [await runA(), await runB()].filter(Boolean) : (await parallel([runA, runB])).filter(Boolean)
    } else {
      tr.notes.push('second attempt worktree failed; one attempt only')
    }
  }
  if (!attempts || !attempts.length) attempts = [await attempt(t, wtA, testsCommit, '', 'impl')]
  tr.attempts = attempts.map(a => ({ tag: a.tag, ok: !!(a.verify && a.verify.ok), problems: (a.verify && a.verify.problems) || [], notes: (a.impl && a.impl.notes) || [] }))
  for (const a of attempts) for (const h of (a.impl && a.impl.human_steps) || []) res.human_steps.push(`${t.id}: ${h}`)

  const green = attempts.filter(a => a.verify && a.verify.ok)
  let win = green[0]
  if (green.length === 2) {
    const j = await step(
      [ctx(R.worktree), '', ticketBrief(t), '', `Tests commit both started from: ${testsCommit}`,
        `Attempt a: worktree ${green[0].wt}, diff: git -C ${green[0].wt} diff ${testsCommit}..HEAD`,
        `Attempt b: worktree ${green[1].wt}, diff: git -C ${green[1].wt} diff ${testsCommit}..HEAD`,
        'Both pass the locked tests. Pick one.'].join('\n'),
      { agentType: 'marrow-judge', schema: JUDGE_SCHEMA, phase: 'Implement', label: `${t.id} judge` },
      { ticket: t.id, outcome: r => `picked ${r.winner}` })
    tr.judge = j || null
    win = j && j.winner === 'b' ? green[1] : green[0]
    if (j && j.graft) tr.notes.push(`judge: worth taking from the other attempt: ${j.graft}`)
  }
  // Drop the losing attempt once there is a winner; keep everything for debugging when there isn't.
  for (const a of win ? attempts.filter(a => a !== win) : []) {
    await sh(`"${S}/lane.sh" remove ${q(R.path)} ${q(a.wt)} ${q(laneBranch(t.id, a.tag === 'b'))}`, `${t.id} drop ${a.tag}`, 'Implement', t.id)
  }
  if (!win) {
    tr.status = 'failed'
    tr.notes.push(`no attempt passed verification: ${attempts.map(a => `${a.tag}: ${((a.verify && a.verify.problems) || ['no result']).join('; ')}`).join(' | ')}`)
    return
  }
  tr.winner = win.tag
  tr.commits = (win.impl && win.impl.commits) || []
  tr.checklist = (win.impl && win.impl.checklist) || []
  tr.notes.push(...((win.impl && win.impl.notes) || []))

  await mergeLock(async () => {
    const branch = win.tag === 'b' ? laneBranch(t.id, true) : laneBranch(t.id)
    // The tests commit goes in a trailer, so a rerun can still give it to the ledger.
    const m = await sh(`"${S}/lane.sh" merge ${q(R.worktree)} ${q(branch)} ${q(`Merge ticket ${t.id}: ${t.title}`)}${tr.tests_commit ? ` ${q(tr.tests_commit)}` : ''}`, `${t.id} merge`, 'Merge', t.id)
    if (!m.ok && m.conflict) {
      const fix = await step(
        ['Mode: resolve', ctx(R.worktree, [`Base branch: ${BASE_BRANCH}`]), '', `Merging ${branch} (ticket ${t.id}: ${t.title}) into ${R.branch} conflicted in: ${(m.files || []).join(', ')}.`,
          'The other side holds tickets already merged in this build; both must keep working.'].join('\n'),
        { agentType: 'marrow-git-sync', schema: SYNC_SCHEMA, phase: 'Merge', label: `${t.id} resolve` },
        { ticket: t.id, outcome: r => r.status })
      // Never leave a merge in progress: settle aborts one that wasn't finished.
      const settled = await sh(`"${S}/lane.sh" settle ${q(R.worktree)}`, `${t.id} settle merge`, 'Merge', t.id)
      if (!fix || fix.status !== 'ok' || !settled.ok) {
        if (settled.ok) await sh(`git -C ${q(R.worktree)} merge --abort; "${S}/lane.sh" settle ${q(R.worktree)}`, `${t.id} abort merge`, 'Merge', t.id)
        tr.status = 'failed'
        tr.notes.push(`merge conflict not resolved: ${fix ? (fix.notes || []).join('; ') || fix.status : 'no result'}${settled.ok ? '' : `; ${settled.error || 'merge aborted'}`}`)
        return
      }
      res.conflicts.push(...((m.files || []).map(f => `${f} (ticket ${t.id})`)))
    } else if (!m.ok) {
      tr.status = 'failed'; tr.notes.push(`merge: ${m.error || 'failed'}`); return
    }
    tr.merged = true
    tr.status = 'merged'
  })
  if (tr.merged) await sh(`"${S}/lane.sh" remove ${q(R.path)} ${q(win.wt)} ${q(win.tag === 'b' ? laneBranch(t.id, true) : laneBranch(t.id))}`, `${t.id} clean up`, 'Merge', t.id)
}

// ---- waves ----

const merged = () => A.tickets.filter(t => res.tickets[t.id].merged)
const lockedTests = () => merged().flatMap(testPaths)

if (int.ok) {
  for (let w = 0; w < A.waves.length; w++) {
    const ids = A.waves[w]
    log(`wave ${w + 1}/${A.waves.length}: ${ids.join(', ')}`)
    await parallel(ids.map(id => () => laneSlot(() => lane(TICKET[id]).catch(e => {
      res.tickets[id].status = 'failed'
      res.tickets[id].notes.push(`workflow error: ${e && e.message ? e.message : e}`)
    }))))
    const wave = { n: w + 1, tickets: ids.map(id => `${id}:${res.tickets[id].status}`) }
    // Integration checks between waves, so a later wave doesn't build on a broken branch.
    if (w < A.waves.length - 1 && ids.some(id => res.tickets[id].merged)) {
      let c = await runChecks(R.worktree, `wave ${w + 1} checks`, 'Merge')
      if (c.ok !== true) {
        await sh(`"${S}/lane.sh" lock ${q(R.worktree)} ${q(JSON.stringify({ owns: [], locked: lockedTests() }))}`, `wave ${w + 1} lock`, 'Merge')
        const red = (c.steps || []).filter(s => !s.ok).map(s => `- ${s.name} (exit ${s.exit_code}): log ${s.log}`)
        const fx = await step(
          [ctx(R.worktree, [`Base: ${res.base}`]), '', `Integration checks are red after wave ${w + 1} merged (${ids.join(', ')}). Fix them in one commit; the acceptance tests are locked.`,
            red.join('\n') || `The check run failed: ${c.error || 'no detail'}`, c.failures ? `Tails: ${c.failures}` : ''].join('\n'),
          { agentType: 'marrow-implementer', schema: IMPL_SCHEMA, phase: 'Merge', label: `wave ${w + 1} fix` },
          { outcome: r => `${r.status}, ${(r.commits || []).length} commit(s)` })
        c = await runChecks(R.worktree, `wave ${w + 1} checks again`, 'Merge')
        wave.fix = fx ? fx.status : 'no result'
      }
      wave.checks = c.ok === true ? 'green' : 'red'
    }
    res.waves.push(wave)
  }
}

// ---- review and fix ----

const REVIEWERS = {
  standards: { agentType: 'marrow-review-standards', heading: 'Standards' },
  spec: { agentType: 'marrow-review-spec', heading: 'Spec' },
  bugs: { agentType: 'marrow-review-bugs', heading: 'Bugs and security' },
  ui: { agentType: 'marrow-review-ui', heading: 'UI' },
}
let uiNote = ''
function reviewerContext(base, head) {
  return [ctx(R.worktree, [`Branch: ${R.branch}`, `Base (the merge-base with origin/${BASE_BRANCH}): ${base}`, `Head: ${head}`,
    `Diff: git -C ${R.worktree} diff ${base}...${head}`, `Commits: git -C ${R.worktree} log --oneline ${base}..${head}`,
    `Tickets merged: ${merged().map(t => `${t.id} ${t.title}`).join('; ') || 'none'}`,
    `Tickets not built: ${A.tickets.filter(t => !res.tickets[t.id].merged).map(t => `${t.id} (${res.tickets[t.id].status})`).join(', ') || 'none'}`]),
    '', 'Read-only. Checks may run in this worktree at the same time; read the branch through git where a build could have touched a file.'].join('\n')
}
const roundNote = p => p.replace(/^fix(\d+)$/, 'fix $1')
async function runReviewers(base, head, names, idPrefix, extra, phase = 'Review') {
  const results = await parallel(names.map(n => () => step(
    [reviewerContext(base, head), '', n === 'spec' ? 'Judge only the merged tickets\' share of the spec; tickets not built are reported separately.' : '', n === 'ui' ? uiNote : '', extra || '',
      'Return every finding through the schema. An empty list is a fine answer.'].filter(Boolean).join('\n'),
    { agentType: REVIEWERS[n].agentType, schema: FINDINGS_SCHEMA, phase, label: `${n}${idPrefix ? ` (${roundNote(idPrefix)})` : ''}` },
    { outcome: r => `${(r.findings || []).length} finding(s)${r.incomplete ? ', incomplete' : ''}` })))
  const out = {}
  names.forEach((n, i) => {
    const r = results[i] || { findings: [], incomplete: true, incomplete_reason: 'the reviewer returned nothing' }
    r.findings = (r.findings || []).map((f, j) => ({ ...f, id: `${idPrefix ? `${idPrefix}-` : ''}${n}-${j + 1}`, reviewer: n }))
    out[n] = r
  })
  return out
}
async function runSkeptic(base, head, findings, label, phase = 'Review') {
  if (!findings.length) return {}
  const r = await step(
    [reviewerContext(base, head), '', 'Judge each finding; exactly one verdict per id. Refute only with a citation (file:line plus quoted code). A high finding is refuted only on proof; doubt is uncertain.', '',
      JSON.stringify(findings.map(f => ({ id: f.id, reviewer: f.reviewer, severity: f.severity, category: f.category, file: f.file, line: f.line, title: f.title, detail: f.detail, evidence: f.evidence })), null, 1)].join('\n'),
    { agentType: 'marrow-skeptic', schema: VERDICT_SCHEMA, phase, label },
    { outcome: r => { const v = r.verdicts || []; return `${v.filter(x => x.verdict === 'confirmed').length} confirmed, ${v.filter(x => x.verdict === 'refuted').length} refuted, ${v.filter(x => x.verdict === 'uncertain').length} uncertain` } })
  const byId = {}
  for (const v of (r && r.verdicts) || []) byId[v.id] = v
  return byId
}
function judge(findings, verdicts) {
  const open = [], refuted = []
  for (const f of findings) {
    const v = verdicts[f.id]
    const withV = { ...f, verdict: v ? v.verdict : 'unjudged', verdict_reason: v ? v.reason : '', citation: v ? (v.citation || '') : '' }
    if (v && v.verdict === 'refuted' && (v.citation || '').trim()) refuted.push(withV)
    else if (v && v.verdict === 'refuted') open.push({ ...withV, verdict: 'refuted without a citation, so kept' })
    else open.push(withV)
  }
  return { open, refuted }
}
async function reviewBugs(base, head, idPrefix, extra, phase) {
  const by = await runReviewers(base, head, ['bugs'], idPrefix, extra, phase)
  const found = Object.values(by).flatMap(r => r.findings)
  return judge(found, await runSkeptic(base, head, found, `skeptic (${roundNote(idPrefix)})`, phase))
}
const needsFix = f => f.severity === 'high' || f.severity === 'medium'
const highCount = fs => fs.filter(f => f.severity === 'high').length
const checksLine = c => !c ? 'not run' : c.ok === true ? 'green' : `red (${c.error || (c.steps || []).filter(s => !s.ok).map(s => s.name).join(', ') || 'no detail'})`
const headOf = async label => {
  const h = await sh(`git -C ${q(R.worktree)} log -1 --format='{"sha":"%H"}'`, label, 'Review')
  return h.sha || res.head
}

async function reviewAndFix() {
  res.head = await headOf('integration head')
  const names = A.lite ? ['spec', 'bugs'] : ['standards', 'spec', 'bugs']
  const skipped = A.lite ? ['standards (lite)'] : []
  // A failed listing still runs the UI reviewer: never skip a review on missing data.
  const ui = await sh(`"${S}/ui-files.sh" ${q(R.worktree)} ${q(res.base)} ${q(res.head)}`, 'ui files', 'Review')
  const uiFiles = ui.ok === true ? ui.files || [] : null
  if (uiFiles && !uiFiles.length) skipped.push('ui (no UI files)')
  else {
    names.push('ui')
    uiNote = uiFiles ? `UI files changed: ${uiFiles.join(', ')}` : `Listing the UI files failed (${ui.error || `exit ${ui.exit_code}`}); find them in the diff.`
  }
  const [c1, review] = await parallel([
    () => runChecks(R.worktree, 'checks', 'Review'),
    async () => {
      const by = await runReviewers(res.base, res.head, names, '', '')
      const all = Object.values(by).flatMap(r => r.findings)
      return { by, ...judge(all, await runSkeptic(res.base, res.head, all, 'skeptic')) }
    },
  ])
  let checks = c1 || { ok: false, error: 'the checks runner failed' }
  const rv = review || { by: {}, open: [], refuted: [] }
  res.reviewers = { ran: names, skipped, incomplete: Object.entries(rv.by).filter(([, r]) => r.incomplete).map(([n, r]) => `${n}: ${r.incomplete_reason || 'no reason'}`) }
  let open = rv.open
  res.refuted.push(...rv.refuted)
  log(`review: checks ${checksLine(checks)}; ${open.length} open (${highCount(open)} high), ${rv.refuted.length} refuted`)

  await sh(`"${S}/lane.sh" lock ${q(R.worktree)} ${q(JSON.stringify({ owns: [], locked: lockedTests() }))}`, 'lock acceptance tests', 'Fix')
  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    const toFix = open.filter(needsFix)
    if (checks.ok === true && !toFix.length) break
    res.rounds = round
    const before = res.head
    const red = (checks.steps || []).filter(s => !s.ok).map(s => `- ${s.name} (exit ${s.exit_code}): log ${s.log}`)
    if (checks.error) red.push(`- the check run failed: ${checks.error}`)
    const fix = await step(
      [ctx(R.worktree, [`Base: ${res.base}`]), '', `Fix round ${round} of ${MAX_FIX_ROUNDS} on the integration branch. The acceptance tests of every merged ticket are locked.`, '',
        red.length ? `Red check steps (first; tails in ${checks.failures || 'the logs'}):\n${red.join('\n')}` : 'Checks are green.', '',
        toFix.length ? `Findings to fix:\n${JSON.stringify(toFix.map(f => ({ id: f.id, severity: f.severity, file: f.file, line: f.line, title: f.title, detail: f.detail, suggestion: f.suggestion || '' })), null, 1)}` : 'No findings to fix.', '',
        'One commit for the round. Report each finding id and red step name in fixes.'].join('\n'),
      { agentType: 'marrow-implementer', schema: IMPL_SCHEMA, phase: 'Fix', label: `implementer fix ${round}` },
      { outcome: r => `${r.status}, ${(r.fixes || []).filter(x => x.fixed).length} fixed` })
    if (!fix || !(fix.commits || []).length) { res.notes.push(`fix round ${round} made no commit${fix ? `: ${(fix.notes || []).join('; ')}` : ''}`); break }
    res.head = await headOf(`head after fix ${round}`)
    for (const h of fix.human_steps || []) res.human_steps.push(`fix ${round}: ${h}`)
    const fixedIds = new Set((fix.fixes || []).filter(x => x.fixed).map(x => x.id))
    for (const f of open.filter(f => fixedIds.has(f.id))) res.fixed.push({ ...f, round })
    open = open.filter(f => !fixedIds.has(f.id))
    for (const x of (fix.fixes || []).filter(x => !x.fixed)) { const f = open.find(o => o.id === x.id); if (f) f.implementer_says = x.reason || '' }
    const [c2, fresh] = await parallel([
      () => runChecks(R.worktree, `checks (fix ${round})`, 'Fix'),
      () => reviewBugs(before, res.head, `fix${round}`, `Fix round ${round}: review only the fix diff ${before}...${res.head} for bugs it introduces or fixes it got wrong.`, 'Fix'),
    ])
    checks = c2 || { ok: false, error: 'the checks runner failed' }
    if (fresh) { open.push(...fresh.open); res.refuted.push(...fresh.refuted) }
  }
  res.checks = checks
  res.open = open
}

// ---- finalize ----

async function finalize() {
  const sync = ['Mode: finalize', `Main checkout: ${R.path}`, `Worktree: ${R.worktree}`, `Feature: ${A.feature} (branch ${R.branch})`, `Base branch: ${BASE_BRANCH}`, `Feature dir: ${A.featureDir}`, `Marrow dir: ${A.marrowDir}`]

  // Bring in origin/<base> (a merge, so the ticket merges and their resolutions survive), then re-check if it moved anything.
  const before = res.head
  const up = await step([...sync, '', 'Update only: do steps 1 and 2, then stop.'].join('\n'),
    { agentType: 'marrow-git-sync', schema: SYNC_SCHEMA, phase: 'Finalize', label: 'update from base' },
    { outcome: r => `${r.status}${r.conflicts_resolved ? ', conflicts resolved' : ''}` })
  const settled = await sh(`"${S}/lane.sh" settle ${q(R.worktree)}`, 'settle update', 'Finalize')
  if (!up || up.status !== 'ok' || !settled.ok) {
    res.notes.push(`update from origin/${BASE_BRANCH}: ${up ? `${up.status} ${(up.notes || []).join('; ')}` : 'no result'}${settled.ok ? '' : `; ${settled.error}`}`)
    res.status = 'red'
    res.why = `could not bring in origin/${BASE_BRANCH}`
    return
  }
  res.head = await headOf('head after update')
  if (up.base) res.base = up.base
  if (res.head !== before) {
    if (up.conflicts_resolved) res.conflicts.push(...(up.conflict_files || []).map(f => `${f} (origin/${BASE_BRANCH})`))
    const [c3, j] = await parallel([
      () => runChecks(R.worktree, 'checks (after update)', 'Finalize'),
      () => up.conflicts_resolved
        ? reviewBugs(before, res.head, 'update', `origin/${BASE_BRANCH} was merged in with conflicts resolved in: ${(up.conflict_files || []).join(', ')}. Check those resolutions.`, 'Finalize')
        : Promise.resolve(null),
    ])
    res.checks = c3 || { ok: false, error: 'the checks runner failed' }
    if (j) { res.open.push(...j.open); res.refuted.push(...j.refuted) }
  }

  // The ledger runs every merged ticket's tests and checks their files are unchanged since its tests commit.
  const built = merged().map(t => res.tickets[t.id].tests_commit ? `${t.id}:${res.tickets[t.id].tests_commit}` : t.id).join(',')
  res.ledger = await sh(`"${S}/ledger.sh" ${q(R.worktree)} ${q(A.planPath)} ${built}`, 'acceptance ledger', 'Finalize')
  await sh(`"${S}/lane.sh" lock ${q(R.worktree)} '{}'`, 'unlock', 'Finalize')
  // Deploy-risk labels from fixed rules; /marrow publish puts them on the PR. A failure here is a note, not red.
  const risk = await sh(`"${S}/risk-labels.sh" ${q(R.worktree)} ${q(res.base)} ${q(res.head)}`, 'risk labels', 'Finalize')
  if (risk && risk.ok === true) res.risk = risk.labels || []
  else res.notes.push(`risk labels did not run: ${(risk && risk.error) || 'no result'}`)

  const why = []
  if (!res.ledger || !Array.isArray(res.ledger.criteria)) why.push('the acceptance ledger did not run')
  const bad = ((res.ledger && res.ledger.criteria) || []).filter(c => c.status === 'fail' || c.status === 'tampered')
  if (bad.length) why.push(`criteria ${bad.map(c => `${c.id} ${c.status}`).join(', ')}`)
  if (!res.checks || res.checks.ok !== true) why.push('checks red')
  const notBuilt = A.tickets.filter(t => !res.tickets[t.id].merged)
  res.status = why.length ? 'red' : notBuilt.length ? 'partial' : 'green'
  res.why = why.length ? why.join('; ') : notBuilt.length ? `not built: ${notBuilt.map(t => t.id).join(', ')}` : ''

  const ledgerLines = ((res.ledger && res.ledger.criteria) || []).map(c => `- ${c.id} ${c.status}: ${c.text}`)
  const material = [
    `Status: ${res.status}${res.why ? ` (${res.why})` : ''}`,
    `Acceptance ledger:\n${ledgerLines.join('\n') || '- unavailable'}`,
    `Tickets:\n${A.tickets.map(t => `- ${t.id} ${t.title}: ${res.tickets[t.id].status}`).join('\n')}`,
    `Checks (${checksLine(res.checks)}):\n${((res.checks && res.checks.steps) || []).map(s => `- ${s.name}: ${s.ok ? 'green' : `red (exit ${s.exit_code})`}`).join('\n')}`,
    res.open.length ? `Open review findings (list each under Risk):\n${res.open.map(f => `- [${f.severity}] ${f.title} (${f.file}${f.line ? `:${f.line}` : ''})`).join('\n')}` : 'Open review findings: none.',
    res.fixed.length ? `Fixed in the review loop: ${res.fixed.length}.` : '',
    res.conflicts.length ? `Conflicts resolved: ${res.conflicts.join(', ')}` : '',
    res.human_steps.length ? `Human steps:\n${res.human_steps.map(s => `- ${s}`).join('\n')}` : 'Human steps: none.',
    res.risk === null ? 'Deploy risk: the labels did not run; leave the section out.'
      : res.risk.length ? `Deploy risk labels (write the Deploy risk section from these):\n${res.risk.map(l => `- ${l.name}: ${l.items.map(i => `${i.key} (${i.file})${i.note ? ` [${i.note}]` : ''}`).join('; ')}`).join('\n')}`
        : 'Deploy risk labels: none.',
    `Implementer notes:\n${A.tickets.flatMap(t => res.tickets[t.id].notes.map(n => `- ${t.id}: ${n}`)).join('\n')}`,
  ].filter(Boolean).join('\n\n')
  const pushNote = A.push === false ? 'Do steps 4 and 5 only: a local build, so no push.' : 'Do steps 3 to 5. The branch is already up to date with the base: skip steps 1 and 2.'
  const fin = await step([...sync, '', pushNote, '', 'PR material:', material].join('\n'),
    { agentType: 'marrow-git-sync', schema: SYNC_SCHEMA, phase: 'Finalize', label: A.push === false ? 'PR body' : 'push and PR body' },
    { outcome: r => `${r.status}${r.pushed_sha ? `, pushed ${r.pushed_sha.slice(0, 10)}` : ''}` })
  res.final = fin || null
  res.pushed = !!(fin && fin.pushed_sha)
  if (!fin || fin.status !== 'ok') {
    res.status = 'red'
    res.why = [res.why, `finalize: ${fin ? `${fin.status} ${(fin.notes || []).join('; ')}` : 'no result'}`].filter(Boolean).join('; ')
  }
}

if (int.ok && merged().length) {
  await reviewAndFix()
  await finalize()
} else if (int.ok) {
  res.why = res.why || 'no ticket merged'
}

// ---- report ----

const SEV = { high: 0, medium: 1, low: 2 }
const loc = f => `\`${f.file}${f.line ? `:${f.line}` : ''}\``
const md = []
md.push(`# Build: ${A.feature}`, '')
md.push(`- Status: **${res.status}**${res.why ? ` (${res.why})` : ''}`)
md.push(`- Branch: \`${R.branch}\`${res.pushed ? ' (pushed)' : ' (not pushed)'}; base \`${res.base}\`, head \`${res.head}\``)
md.push(`- Checks: ${checksLine(res.checks)}`)
if (res.risk) md.push(`- Deploy risk labels: ${res.risk.length ? res.risk.map(l => `${l.name} (${l.items.map(i => i.key).join(', ')})`).join('; ') : 'none'}`)
md.push(`- Open findings: ${res.open.length} (${highCount(res.open)} high); fixed ${res.fixed.length}; refuted ${res.refuted.length}`)
md.push(`- Waves: ${res.waves.map(w => `[${w.tickets.join(', ')}]${w.checks ? ` checks ${w.checks}` : ''}`).join(' → ')}`)
if (res.rounds) md.push(`- Review fix rounds: ${res.rounds}`)
if (res.conflicts.length) md.push(`- Conflicts resolved: ${res.conflicts.join(', ')}`)
for (const n of res.notes) md.push(`- Note: ${n}`)
md.push('', '## Acceptance', '')
if (res.ledger && res.ledger.criteria) {
  md.push('| Criterion | Status | Tickets |', '| --- | --- | --- |')
  for (const c of res.ledger.criteria) md.push(`| ${c.id}: ${String(c.text).replace(/\|/g, '/')} | ${c.status} | ${c.tickets.join(', ')} |`)
} else md.push('No ledger (nothing merged, or the ledger run failed).')
md.push('', '## Tickets', '')
for (const t of A.tickets) {
  const tr = res.tickets[t.id]
  md.push(`- **${t.id} ${t.title}** (${tr.difficulty}): ${tr.status}${tr.winner ? `, attempt ${tr.winner}` : ''}${tr.tests_commit ? `, tests \`${tr.tests_commit.slice(0, 10)}\`` : ''}`)
  if (tr.judge) md.push(`  - Judge: ${tr.judge.winner}: ${tr.judge.reason}${tr.judge.breaking_input ? ` Breaking input for the other: ${tr.judge.breaking_input}` : ''}`)
  for (const a of tr.attempts.filter(a => !a.ok)) md.push(`  - Attempt ${a.tag} failed: ${a.problems.join('; ')}`)
  for (const c of (tr.checklist || []).filter(c => !c.done)) md.push(`  - Not done: ${c.item}`)
  for (const n of tr.notes) md.push(`  - ${n}`)
}
if (res.checks) {
  md.push('', '## Checks', '')
  if (res.checks.error) md.push(`Checks did not run cleanly: ${res.checks.error}`)
  else {
    md.push('| Step | Result | Seconds |', '| --- | --- | --- |')
    for (const s of res.checks.steps || []) md.push(`| ${s.name} | ${s.ok ? 'green' : `red (exit ${s.exit_code})`} | ${s.seconds} |`)
  }
  if (res.checks.failures) md.push('', `Red step output: \`${res.checks.failures}\``)
}
if (res.reviewers) {
  md.push('', '## Findings', '')
  if (res.reviewers.incomplete.length) md.push(`**Incomplete reviewers:** ${res.reviewers.incomplete.join('; ')}`, '')
  if (!res.open.length) md.push('No open findings.')
  for (const f of [...res.open].sort((a, b) => SEV[a.severity] - SEV[b.severity])) {
    md.push(`- **[${f.severity}] ${f.title}** (${f.reviewer}, ${f.category}) ${loc(f)}, skeptic: ${f.verdict}`)
    md.push(`  ${f.detail}`)
    if (f.suggestion) md.push(`  Fix: ${f.suggestion}`)
    if (f.implementer_says) md.push(`  Implementer: ${f.implementer_says}`)
  }
  if (res.fixed.length) { md.push('', `Fixed in the loop (${res.fixed.length}):`); for (const f of res.fixed) md.push(`- [${f.severity}] ${f.title} ${loc(f)}, round ${f.round}`) }
  if (res.refuted.length) { md.push('', `Refuted (${res.refuted.length}):`); for (const f of res.refuted) md.push(`- [${f.severity}] ${f.title} (${f.reviewer}) ${loc(f)}: ${f.verdict_reason} Citation: ${String(f.citation).replace(/\n/g, ' ').slice(0, 300)}`) }
}
md.push('', '## Human steps', '')
if (!res.human_steps.length) md.push('None.')
for (const h of res.human_steps) md.push(`- ${h}`)
md.push('')

const lg = [`# Agent log: ${A.feature}`, '', 'Every agent the build ran, in start order. Only implementers and git-sync report times.', '',
  '| # | Phase | Label | Agent | Ticket | Started | Finished | Outcome |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
const entries = [...LOG].sort((a, b) => a.seq - b.seq)
for (const e of entries) lg.push(`| ${e.seq} | ${e.phase} | ${e.label} | ${e.agent} | ${e.ticket} | ${e.started_at} | ${e.finished_at} | ${String(e.outcome).replace(/\|/g, '/')} |`)
lg.push('')
for (const e of entries.filter(e => e.commits.length || e.files.length || e.commands.length)) {
  lg.push(`## ${e.seq}. ${e.label}`, '')
  if (e.commits.length) lg.push(`- Commits: ${e.commits.map(c => `\`${String(c).slice(0, 12)}\``).join(' ')}`)
  if (e.files.length) lg.push(`- Files (${e.files.length}): ${e.files.map(f => `\`${f}\``).join(', ')}`)
  if (e.commands.length) { lg.push('- Commands:'); for (const c of e.commands) lg.push(`  - \`${String(c.cmd).replace(/`/g, "'").slice(0, 300)}\` → exit ${c.exit_code}`) }
  lg.push('')
}

return {
  markdown: md.join('\n'),
  agentLogMarkdown: lg.join('\n'),
  summary: {
    feature: A.feature, status: res.status, why: res.why, branch: R.branch, pushed: res.pushed, head: res.head, base_branch: BASE_BRANCH,
    checks_ok: !!(res.checks && res.checks.ok), open: res.open.length, open_high: highCount(res.open),
    fixed: res.fixed.length, refuted: res.refuted.length,
    tickets: A.tickets.map(t => ({ id: t.id, status: res.tickets[t.id].status })),
    criteria: ((res.ledger && res.ledger.criteria) || []).map(c => ({ id: c.id, status: c.status })),
    human_steps: res.human_steps.length,
    labels: (res.risk || []).map(l => l.name),
  },
  ledger: res.ledger,
  pr: res.final && res.final.pr_title ? { title: res.final.pr_title, body: res.final.pr_body || '' } : null,
  tickets_done: A.tickets.filter(t => res.tickets[t.id].merged).map(t => ({ id: t.id, commits: res.tickets[t.id].commits || [] })),
  failures: res.checks && res.checks.failures ? res.checks.failures : null,
}
