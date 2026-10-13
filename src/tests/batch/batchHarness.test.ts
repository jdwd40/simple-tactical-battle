import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DUEL_RULES, type PlanOpponent } from '../../contracts'
import { DUEL_SCENARIO } from '../../scenarios/private'
import { initialiseSession, observeSide, validateOrders } from '../../simulation'
import { parseArguments } from '../../../tools/batch/arguments'
import { replayArtifact, runEncounter } from '../../../tools/batch/encounter'
import { replayFile, writeArtifact } from '../../../tools/batch/files'
import { checkState } from '../../../tools/batch/invariants'
import { diagnosticJSON, parseDiagnosticJSON } from '../../../tools/batch/json'
import { holdOrders, playerPolicy, POLICY_NAMES } from '../../../tools/batch/policies'

const input = { seed: 52, policy: 'scan-search' as const, normalTurnLimit: 2, sourceRevision: 'harness-fixture' }

describe('optional headless batch harness', () => {
  it('requires explicit bounded seeds, distinct known policies and a diagnostic limit', () => {
    expect(parseArguments(['--seeds', '0,1', '--out', '/tmp/batch'])).toMatchObject({ seeds: [0, 1], limit: 200, policies: POLICY_NAMES })
    for (const args of [[], ['--seeds', '1,1', '--out', '/tmp/batch'], ['--seeds', '1,2,3,4,5,6', '--out', '/tmp/batch'],
      ['--seeds', '-1', '--out', '/tmp/batch'], ['--seeds', '4294967296', '--out', '/tmp/batch'],
      ['--seeds', '1', '--out', '/tmp/batch', '--limit', '201'], ['--seeds', '1', '--out', '/tmp/batch', '--limit', '0'],
      ['--seeds', '1', '--out', '/tmp/batch', '--policies', 'unknown'], ['--replay', '/tmp/file', '--limit', '1'], ['--limit']]) {
      expect(() => parseArguments(args)).toThrow()
    }
  })

  it('records cutoff without a gameplay outcome and replays serialized planner state/envelopes exactly', () => {
    const result = runEncounter(input)
    expect(result.metrics).toMatchObject({ status: 'diagnostic-cutoff', outcome: null, normalTurns: 2, automaticTurns: 0, invariantFailures: [] })
    expect(result.finalState.outcome).toBeNull()
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].plannerRandom.patrol).not.toBe(result.initialState.random.planners.patrol)
    expect(result.steps.map((s) => s.locked)).toEqual(result.finalState.acceptedTurns)
    expect(runEncounter(input)).toEqual(result)
    const directory = mkdtempSync(join(tmpdir(), 'tsb-52a-replay-test-'))
    try {
      const path = join(directory, 'cutoff.json')
      writeArtifact(path, result)
      expect(replayFile(path)).toMatchObject({ verified: true, status: 'diagnostic-cutoff', outcome: null, finalStateHash: result.metrics.finalStateHash })
      const changed = JSON.parse(readFileSync(path, 'utf8'))
      changed.finalState.ships.player.hull--
      expect(() => replayArtifact(changed)).toThrow('Replay final state mismatch')
    } finally { rmSync(directory, { recursive: true }) }
  })

  it('records diagnostic policy rejection and explicit hold fallback separately from production failure', () => {
    const result = runEncounter({ ...input, normalTurnLimit: 1, player: (view) => ({ ...holdOrders(view), movement: { kind: 'destination', cell: { column: 20, row: 0 } } }) })
    expect(result.metrics.status).toBe('diagnostic-cutoff')
    expect(result.metrics.rejections).toMatchObject([{ side: 'player', action: 'hold-fallback', origin: 'diagnostic-policy', issues: [{ severity: 'error', code: 'out-of-bounds' }] }])
    expect(result.steps[0].locked.orders.player?.movement).toEqual({ kind: 'hold' })
    expect(replayArtifact(result).verified).toBe(true)
  })

  it('stops on a malformed planner order, preserves its boundary and verifies rejection from a reproduction file', () => {
    const malformed: PlanOpponent = (view, memory, plannerRandomState) => ({ orders: { ...holdOrders(view), weapon: { kind: 'laser', contactAlias: 'unseen' } }, memory, plannerRandomState })
    const result = runEncounter({ ...input, planner: malformed })
    expect(result.metrics).toMatchObject({ status: 'failure', outcome: null, normalTurns: 0 })
    expect(result.steps).toEqual([])
    expect(result.failure?.stage).toBe('patrol-validation')
    expect(result.metrics.rejections).toMatchObject([{ origin: 'production-planner', action: 'stop', issues: [{ code: 'unknown-alias' }] }])
    const directory = mkdtempSync(join(tmpdir(), 'tsb-52a-negative-test-'))
    try {
      const path = join(directory, 'invalid-planner.json')
      writeArtifact(path, result)
      expect(replayFile(path)).toMatchObject({ verified: true, boundary: 'reproduced invalid planner order', finalTick: 0 })
    } finally { rmSync(directory, { recursive: true }) }
  })

  it('detects impossible ammunition, nonfinite state and cooldown regression independently of encounter outcomes', () => {
    const invalidNumbers = { nan: NaN, infinity: Infinity, negativeInfinity: -Infinity, negativeZero: -0 }
    expect(parseDiagnosticJSON(diagnosticJSON(invalidNumbers))).toEqual(invalidNumbers)
    const state = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 52)
    expect(() => checkState({ ...state, ships: { ...state.ships, player: { ...state.ships.player, ammunition: -1 } } }, DUEL_RULES, DUEL_SCENARIO)).toThrow('ammunition out of bounds')
    expect(() => checkState({ ...state, tick: NaN }, DUEL_RULES, DUEL_SCENARIO)).toThrow('not finite')
    const before = { ...state, ships: { ...state.ships, player: { ...state.ships.player, missileReadyTick: 100 } } }
    expect(() => checkState(state, DUEL_RULES, DUEL_SCENARIO, before)).toThrow('cooldown regression')
  })

  it.each(POLICY_NAMES)('generates legal observation-only first-turn orders for %s', (name) => {
    const own = observeSide(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 52), 'player', DUEL_RULES, DUEL_SCENARIO)
    const draft = playerPolicy(name, DUEL_RULES)(own)
    expect(validateOrders(draft, own, DUEL_RULES).structurallyValid).toBe(true)
  })

  it('predicts a missile from measured velocity and switches movement to evasion using a public hostile sighting', () => {
    const initial = observeSide(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 52), 'player', DUEL_RULES, DUEL_SCENARIO)
    const view = { ...initial, contacts: [{ alias: 'contact-1', kind: 'current' as const, ageTicks: 0 as const, uncertaintyRadiusUnits: 0 as const,
      measurement: { position: { x: 10500, y: 10500 }, tick: 0 }, estimatedVelocity: { xUnitsPerTick: 0, yUnitsPerTick: -80 } }] }
    const policy = playerPolicy('predictive-missile', DUEL_RULES)
    expect(policy(view).weapon).toEqual({ kind: 'missile', aim: { column: 10, row: 7 } })
    const threatened = { ...view, hostileMissiles: [{ alias: 'missile-1', kind: 'current' as const, ageTicks: 0 as const, uncertaintyRadiusUnits: 0 as const,
      measurement: { position: { x: 4500, y: 10500 }, tick: 0 } }] }
    expect(policy(threatened).movement).not.toEqual(policy(view).movement)
    expect(validateOrders(policy(threatened), threatened, DUEL_RULES).structurallyValid).toBe(true)
    expect(policy({ ...view, observedOpponentDestructionTick: 0 }).weapon).toEqual({ kind: 'hold' })
  })
})
