import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function moduleUrl(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const ai = await import(moduleUrl('../src/domain/ai.ts'))

test('automatic recommendation stages increase search and matching timeout strength', () => {
  assert.deepEqual(
    ai.AUTO_RECOMMENDATION_STAGES,
    [
      { maxVisits: 300, strength: 'casual' },
      { maxVisits: 1200, strength: 'normal' },
      { maxVisits: 4000, strength: 'strong' },
      { maxVisits: 10000, strength: 'expert' },
    ],
  )
  assert.deepEqual(ai.AUTO_RECOMMENDATION_BUDGETS, [300, 1200, 4000, 10000])
})

test('search budget grows continuously from 20k to the unique 9d maximum', () => {
  const ordered = [
    ...Array.from({ length: 20 }, (_, index) => `rank_${20 - index}k`),
    ...Array.from({ length: 9 }, (_, index) => `rank_${index + 1}d`),
  ]
  const budgets = ordered.map((strength) => ai.AI_STRENGTHS[strength].visitBudget)
  assert.ok(budgets.every((value, index) => index === 0 || value >= budgets[index - 1]))
  assert.equal(ai.AI_STRENGTHS.rank_20k.visitBudget, 40)
  assert.equal(ai.AI_STRENGTHS.rank_9d.visitBudget, 1200)
  assert.equal(budgets.filter((value) => value === 1200).length, 1)
  assert.ok(ai.AI_STRENGTHS.rank_1d.visitBudget > ai.AI_STRENGTHS.rank_1k.visitBudget)
})

test('search correction and policy sharpening never fall across tiers', () => {
  const ordered = [
    ...Array.from({ length: 20 }, (_, index) => `rank_${20 - index}k`),
    ...Array.from({ length: 9 }, (_, index) => `rank_${index + 1}d`),
  ]
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ai.AI_STRENGTHS[ordered[index - 1]]
    const current = ai.AI_STRENGTHS[ordered[index]]
    assert.ok(current.visitBudget >= previous.visitBudget)
    assert.ok(current.policyTemperature <= previous.policyTemperature)
    assert.ok(current.searchUtilityWeight >= previous.searchUtilityWeight)
    assert.ok(current.searchUtilityLambda <= previous.searchUtilityLambda)
  }
  assert.ok(ai.AI_STRENGTHS.rank_1d.visitBudget > ai.AI_STRENGTHS.rank_20k.visitBudget)
})

test('every tier keeps the search pass judgement', () => {
  for (const config of Object.values(ai.AI_STRENGTHS)) {
    assert.equal(config.allowSearchPass, true)
  }
})

test('display groups match the low, middle, and high rank bands', () => {
  assert.equal(ai.AI_STRENGTHS.rank_11k.group, '低级')
  assert.equal(ai.AI_STRENGTHS.rank_10k.group, '中级')
  assert.equal(ai.AI_STRENGTHS.rank_1k.group, '中级')
  assert.equal(ai.AI_STRENGTHS.rank_1d.group, '高级')
  assert.equal(ai.AI_STRENGTHS.rank_9d.group, '高级')
})

test('Human SL stays raw at 20k while search influence scales to full strength', () => {
  assert.equal(ai.AI_STRENGTHS.rank_20k.policyTemperature, 1.15)
  assert.equal(ai.AI_STRENGTHS.rank_20k.searchUtilityWeight, 0)
  assert.equal(ai.AI_STRENGTHS.rank_9d.policyTemperature, 1)
  assert.equal(ai.AI_STRENGTHS.rank_9d.searchUtilityWeight, 1)
  assert.ok(ai.AI_STRENGTHS.rank_1d.searchUtilityWeight > ai.AI_STRENGTHS.rank_1k.searchUtilityWeight)
})

test('resignation behavior is constant so it does not distort the rank curve', () => {
  const first = ai.AI_STRENGTHS.rank_20k
  for (const config of Object.values(ai.AI_STRENGTHS)) {
    assert.equal(config.resignThreshold, first.resignThreshold)
    assert.equal(config.resignConsecutiveTurns, first.resignConsecutiveTurns)
  }
})

test('every tier samples from the complete Human SL policy vector', () => {
  const policy = Array(362).fill(-1)
  policy[ai.policyCoordinateIndex('D4')] = 0.05
  policy[ai.policyCoordinateIndex('Q4')] = 0.9
  const legal = ['D4', 'Q4']
  assert.equal(ai.selectHumanPolicyMove(policy, { legalMoves: legal }, () => 0.06), 'Q4')

  // The low-probability move remains reachable even when it is not a search
  // candidate. Sampling must depend only on the policy and legal board moves.
  assert.equal(
    ai.selectHumanPolicyMove(
      policy,
      { legalMoves: legal },
      () => 0.01,
    ),
    'D4',
  )
})

test('invalid policy entries, pass, and empty boards never yield a board move', () => {
  const invalid = Array(362).fill(-1)
  invalid[ai.policyCoordinateIndex('D4')] = Number.NaN
  invalid[ai.policyCoordinateIndex('Q4')] = Number.POSITIVE_INFINITY
  invalid[ai.policyCoordinateIndex('D16')] = 0
  invalid[361] = 1
  assert.equal(ai.selectHumanPolicyMove(invalid, { legalMoves: ['D4', 'Q4', 'D16'] }), null)

  const onlyPass = Array(362).fill(-1)
  onlyPass[361] = 1
  assert.equal(ai.selectHumanPolicyMove(onlyPass), null)
  assert.equal(ai.selectHumanPolicyMove(Array(361).fill(0.1)), null)
})

test('dense policy indices map to the requested board size', () => {
  const policy = Array(82).fill(-1)
  policy[ai.policyCoordinateIndex('A9', 9)] = 0.6
  policy[ai.policyCoordinateIndex('J1', 9)] = 0.4
  assert.equal(
    ai.selectHumanPolicyMove(
      policy,
      { boardSize: 9, legalMoves: ['A9', 'J1'] },
      () => 0.85,
    ),
    'J1',
  )
})

test('policy vector coordinates follow KataGo row-major order and exclude pass', () => {
  const policy = Array(362).fill(-1)
  assert.equal(ai.policyCoordinateIndex('A19'), 0)
  assert.equal(ai.policyCoordinateIndex('T1'), 360)
  assert.equal(ai.policyCoordinateIndex('pass'), 361)
  policy[0] = 0.5
  policy[361] = 0.5
  assert.equal(ai.selectHumanPolicyMove(policy, {}, () => 1), 'A19')
})

test('weak tiers do not let search utility change the Human SL move distribution', () => {
  const policy = Array(362).fill(-1)
  policy[ai.policyCoordinateIndex('D4')] = 0.9
  policy[ai.policyCoordinateIndex('Q4')] = 0.1
  const candidates = [
    { move: 'D4', utility: -0.8, prior: 0.9, visits: 8 },
    { move: 'Q4', utility: 0.2, prior: 0.1, visits: 8 },
  ]
  assert.equal(ai.selectHumanPolicyMove(
    policy,
    { legalMoves: ['D4', 'Q4'], searchCandidates: candidates, searchUtilityWeight: 0 },
    () => 0.0,
  ), 'D4')
  assert.equal(ai.selectHumanPolicyMove(
    policy,
    { legalMoves: ['D4', 'Q4'], searchCandidates: candidates, searchUtilityWeight: 0 },
    () => 0.11,
  ), 'D4')
})

test('high dan search utility can correct a weak human preference', () => {
  const policy = Array(362).fill(-1)
  policy[ai.policyCoordinateIndex('D4')] = 0.9
  policy[ai.policyCoordinateIndex('Q4')] = 0.1
  const candidates = [
    { move: 'D4', utility: -0.8, prior: 0.9, visits: 8 },
    { move: 'Q4', utility: 0.2, prior: 0.1, visits: 8 },
  ]
  assert.equal(ai.selectHumanPolicyMove(
    policy,
    {
      legalMoves: ['D4', 'Q4'],
      searchCandidates: candidates,
      searchUtilityWeight: 1,
      searchUtilityLambda: 0.1,
    },
    () => 0.5,
  ), 'Q4')
})

test('white search utility uses the AI perspective', () => {
  const policy = Array(362).fill(-1)
  policy[ai.policyCoordinateIndex('D4')] = 0.9
  policy[ai.policyCoordinateIndex('Q4')] = 0.1
  const candidates = [
    { move: 'D4', utility: 0.8, prior: 0.9, visits: 8 },
    { move: 'Q4', utility: -0.2, prior: 0.1, visits: 8 },
  ]
  assert.equal(ai.selectHumanPolicyMove(policy, {
    legalMoves: ['D4', 'Q4'],
    searchCandidates: candidates,
    searchUtilityWeight: 1,
    searchUtilityLambda: 0.1,
    aiColor: 'white',
  }, () => 0.5), 'Q4')
})

test('pass needs both an ending phase and an explicit search recommendation', () => {
  assert.equal(ai.shouldAcceptSearchPass('rank_20k', { move: 'pass' }, 20, false), false)
  assert.equal(ai.shouldAcceptSearchPass('rank_20k', { move: 'pass' }, 80, false), true)
  assert.equal(ai.shouldAcceptSearchPass('rank_20k', { move: 'D4' }, 80, true), false)
  assert.equal(ai.passJudgementVisits('rank_20k', 80), ai.AI_STRENGTHS.rank_20k.visitBudget)
  assert.equal(ai.passJudgementVisits('rank_20k', 20), 0)
})

test('a nearly unsearched candidate cannot dominate the whole policy', () => {
  const policy = Array(362).fill(-1)
  policy[ai.policyCoordinateIndex('D4')] = 0.9
  policy[ai.policyCoordinateIndex('Q4')] = 0.1
  assert.equal(ai.selectHumanPolicyMove(policy, {
    legalMoves: ['D4', 'Q4'],
    searchCandidates: [{ move: 'Q4', utility: 1, prior: 0.001, visits: 1 }],
    searchUtilityWeight: 1,
    searchUtilityLambda: 0.1,
  }, () => 0.05), 'D4')
})
