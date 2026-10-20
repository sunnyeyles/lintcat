export const meta = {
  name: 'marrow-plan',
  description: 'Turn an approved spec into a checked, critiqued plan of tickets',
  whenToUse: 'Started by /marrow after the spec is approved; not for direct use',
  phases: [
    { title: 'Plan', detail: 'marrow-planner writes plan.json' },
    { title: 'Check', detail: 'plan-check.sh: coverage, dependencies, ownership, waves' },
    { title: 'Critique', detail: 'marrow-plan-critic reads the plan cold against the spec and code' },
  ],
}

// args: { feature, repoPath, featureDir, specPath, marrowDir }
const A = args || {}
for (const k of ['feature', 'repoPath', 'featureDir', 'specPath', 'marrowDir']) {
  if (!A[k] || typeof A[k] !== 'string') throw new Error(`marrow-plan: missing args.${k}`)
}
const PLAN = `${A.featureDir}/plan.json`
const MAX_REVISIONS = 2

const RUN_SCHEMA = {
  type: 'object',
  properties: {
    exit_code: { type: 'integer' },
    stdout_json: { type: 'string', description: 'what the command printed on stdout, verbatim' },
  },
  required: ['exit_code', 'stdout_json'],
}
const PLANNER_SCHEMA = {
  type: 'object',
  properties: {
    tickets: { type: 'integer' },
    summary: { type: 'string' },
    questionable: { type: 'array', items: { type: 'string' }, description: 'decisions a reviewer should question' },
  },
  required: ['tickets', 'summary'],
}
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          ticket: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'ticket', 'title', 'detail', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const context = [
  `Repo: ${A.repoPath}`,
  `Feature: ${A.feature}`,
  `Feature dir: ${A.featureDir}`,
  `Approved spec: ${A.specPath}`,
  `Plan file: ${PLAN}`,
  `Marrow dir: ${A.marrowDir}`,
  `Repo notes: ${A.repoPath}/.marrow/notes.md`,
].join('\n')

async function check(round) {
  const r = await agent(
    [`Run this one command and report it:`, '', `"${A.marrowDir}/scripts/plan-check.sh" "${A.featureDir}"`, '',
      'Put the exit code in exit_code and what it printed on stdout in stdout_json, exactly as printed.'].join('\n'),
    { agentType: 'marrow-runner', effort: 'low', schema: RUN_SCHEMA, phase: 'Check', label: `plan-check ${round}` })
  try {
    return JSON.parse(r.stdout_json)
  } catch (e) {
    return { ok: false, errors: [`plan-check.sh output was not JSON: ${r ? String(r.stdout_json).slice(0, 500) : 'no result'}`], warnings: [], waves: [] }
  }
}

let planner = await agent(
  [context, '', 'Write plan.json for this spec, following your instructions, then run plan-check.sh and fix what it reports.'].join('\n'),
  { agentType: 'marrow-planner', schema: PLANNER_SCHEMA, phase: 'Plan', label: 'planner' })

let checked = await check(0)
let critique = { findings: [] }
for (let round = 1; round <= MAX_REVISIONS + 1; round++) {
  critique = checked.ok
    ? (await agent(
      [context, '', 'Review plan.json against the spec and the code. A deterministic check passed:', JSON.stringify(checked, null, 1)].join('\n'),
      { agentType: 'marrow-plan-critic', schema: CRITIC_SCHEMA, phase: 'Critique', label: `critic ${round}` })) || { findings: [] }
    : { findings: [] }
  const blocking = critique.findings.filter(f => f.severity !== 'low')
  log(`round ${round}: plan-check ${checked.ok ? 'ok' : `${checked.errors.length} error(s)`}, critic ${blocking.length} high/medium`)
  if ((checked.ok && !blocking.length) || round > MAX_REVISIONS) break
  planner = await agent(
    [context, '', `Revise plan.json (revision ${round} of ${MAX_REVISIONS}).`,
      checked.ok ? '' : `plan-check.sh errors:\n${checked.errors.map(e => `- ${e}`).join('\n')}`,
      blocking.length ? `Critic findings to address (fix them in the plan, or say in questionable why not):\n${JSON.stringify(blocking, null, 1)}` : '',
      'Change only what these need, then run plan-check.sh again.'].join('\n'),
    { agentType: 'marrow-planner', schema: PLANNER_SCHEMA, phase: 'Plan', label: `planner rev ${round}` })
  checked = await check(round)
}

const md = await agent(
  [`Run this one command and report it:`, '', `"${A.marrowDir}/scripts/plan-check.sh" "${A.featureDir}" --markdown`, '',
    'Put the exit code in exit_code and what it printed on stdout in stdout_json, exactly as printed.'].join('\n'),
  { agentType: 'marrow-runner', effort: 'low', schema: RUN_SCHEMA, phase: 'Check', label: 'render plan' })

return {
  ok: !!checked.ok,
  check: checked,
  planner: planner || null,
  open_findings: critique.findings,
  plan_markdown: md ? md.stdout_json : '',
}
